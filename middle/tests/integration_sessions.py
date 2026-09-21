"""Opt-in REST/MongoDB contract check; run from middle with its venv Python.

Requires Node.js, installed backend dependencies, and backend/.env credentials.
Uses the existing isolated test-database guard, a temporary user, and no live LLM.
"""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import uuid
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from openai.types.chat import ChatCompletionMessage

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "middle"))
import app as middle_app
import resolution


NODE_FIXTURE = """
import { randomUUID } from 'node:crypto';
import { testDatabaseName } from './src/scripts/testDatabase.js';
import app from './src/app.js';
import jwt from 'jsonwebtoken';
import { connectDatabase, disconnectDatabase } from './src/config/database.js';
import Session from './src/models/Session.js';
import Turn from './src/models/Turn.js';
import User from './src/models/User.js';
let user, server;
try {
  console.log(JSON.stringify({phase: 'Connecting to the isolated test database'}));
  const deadline = setTimeout(() => {
    console.error('Test database connection did not finish within 45 seconds');
    process.exit(2);
  }, 45000);
  const connection = await connectDatabase();
  clearTimeout(deadline);
  if (connection.name !== testDatabaseName) throw new Error('Wrong test database');
  console.log(JSON.stringify({phase: 'Creating indexes and a temporary test user'}));
  await Promise.all([Session.init(), Turn.init(), User.init()]);
  user = await User.create({email: 'middle-integration-' + randomUUID() + '@example.com',
    displayName: 'Middle integration', passwordHash: 'unused', status: 'ACTIVE'});
  const token = jwt.sign({type: 'access'}, process.env.JWT_SECRET, {
    algorithm: 'HS256', subject: user._id.toString(), expiresIn: '24h', jwtid: randomUUID(),
    issuer: 'flight-booking-api', audience: 'flight-booking-android',
  });
  await User.updateOne({_id: user._id}, {$push: {tokens: token}});
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  console.log(JSON.stringify({url: 'http://127.0.0.1:' + server.address().port, token}));
  await new Promise(resolve => { process.stdin.once('data', resolve); process.stdin.once('end', resolve); });
  process.stdin.pause();
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (user) {
    const sessions = await Session.find({user: user._id}).select('_id');
    await Turn.deleteMany({session: {$in: sessions.map(item => item._id)}});
    await Session.deleteMany({user: user._id});
    await User.deleteOne({_id: user._id});
  }
  await disconnectDatabase();
}
"""


def main():
    error_log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
    process = subprocess.Popen(
        ["node", "--input-type=module", "-e", NODE_FIXTURE], cwd=ROOT / "backend",
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error_log, text=True,
    )
    try:
        while True:
            line = process.stdout.readline()
            if not line:
                error_log.seek(0)
                raise RuntimeError("REST fixture failed: " + error_log.read()[-2000:])
            ready = json.loads(line)
            if "url" in ready:
                break
            print(ready["phase"], flush=True)
        print("Testing FastAPI against the real REST backend", flush=True)
        backend = resolution.BackendClient(ready["url"], timeout_seconds=30)
        captured = []
        tool_message = ChatCompletionMessage(role="assistant", content=None,
            reasoning_content="Read bookings before answering.", tool_calls=[{
                "id": "call-bookings", "type": "function",
                "function": {"name": "list_my_bookings", "arguments": '{"page":1}'},
            }])
        replies = iter([tool_message, ChatCompletionMessage(role="assistant", content="No bookings.")])
        def completion(**kwargs):
            captured.append(copy.deepcopy(resolution.serialize_messages(kwargs["messages"])))
            return SimpleNamespace(choices=[SimpleNamespace(message=next(replies))])
        model = Mock()
        model.create.side_effect = completion
        assistant = resolution.FlightBookingAssistant(
            deepseek_client=SimpleNamespace(chat=SimpleNamespace(completions=model)),
            tool_executor=resolution.ToolExecutor(backend),
        )
        middle_app.app.dependency_overrides[middle_app.get_backend] = lambda: backend
        with patch.object(middle_app, "_assistant", assistant), TestClient(middle_app.app) as client:
            headers = {"Authorization": "Bearer " + ready["token"]}
            body = {"sessionId": str(uuid.uuid4()), "requestId": str(uuid.uuid4()), "message": "Show my bookings"}
            first = client.post("/api/chat", headers=headers, json=body)
            assert first.status_code == 200, first.text
            session_id = body["sessionId"]
            stored = backend.get_session(session_id, ready["token"]).body["data"]["session"]
            messages = stored["turns"][0]["messages"]
            assert [item["role"] for item in messages] == ["user", "assistant", "tool", "assistant"]
            assert messages[1]["reasoning_content"] == tool_message.reasoning_content
            assert first.json()["events"] == stored["turns"][0]["view"]["events"]
            with patch.object(middle_app, "_assistant", None), patch.object(middle_app, "get_assistant") as factory:
                replay = client.post("/api/chat", headers=headers, json=body)
                assert replay.status_code == 200 and replay.json()["replayed"], replay.text
                factory.assert_not_called()
            replies = iter([ChatCompletionMessage(role="assistant", content="There are no bookings to cancel.")])
            body.update(requestId=str(uuid.uuid4()), message="Can I cancel the first one?")
            followup = client.post("/api/chat", headers=headers, json=body)
            assert followup.status_code == 200, followup.text
            assert captured[-1][1:-1] == messages
            model.create.side_effect = resolution.AssistantResponseError("Test provider failure")
            body.update(requestId=str(uuid.uuid4()), message="Try again")
            failed = client.post("/api/chat", headers=headers, json=body)
            assert failed.status_code == 502, failed.text
            view = client.get(f"/api/chat/sessions/{session_id}", headers=headers).json()["data"]["session"]
            assert [turn["sequence"] for turn in view["turns"]] == [1, 2, 3]
            assert view["turns"][-1]["status"] == "failed"
            assert all("messages" not in turn for turn in view["turns"])
            assert "reasoning_content" not in json.dumps(view)
            listing = client.get("/api/chat/sessions", headers=headers).json()["data"]["sessions"]
            assert any(item["sessionId"] == session_id for item in listing)
            assert client.delete(f"/api/chat/{session_id}", headers=headers).status_code == 204
            assert backend.get_session(session_id, ready["token"]).status_code == 404
        print("PASS: real REST persistence, SDK/tool transcript, replay, context restore, failure view and deletion")
    finally:
        middle_app.app.dependency_overrides.clear()
        try:
            process.communicate("stop\n", timeout=60)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise RuntimeError("REST fixture cleanup timed out")
        error_log.close()
        if process.returncode and sys.exc_info()[0] is None:
            raise RuntimeError("REST fixture or test-record cleanup failed")


if __name__ == "__main__":
    main()
