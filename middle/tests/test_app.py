from __future__ import annotations

import copy
import json
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from openai.types.chat import ChatCompletionMessage

try:
    from middle import app as middle_app, resolution
except ImportError:
    import app as middle_app
    import resolution


def response(code, **body):
    return resolution.BackendResponse(code, body)


class BackendFixture:
    """Fake REST persistence outlives middle-layer assistant instances."""
    def __init__(self):
        self.sessions = {}
        self.tokens = {"token": "alice", "other": "bob"}
        self.calls = []
        self.finish_failures = []
        self.start_failure = False

    def request(self, method, path, *, json_body=None, access_token=None, query=None):
        self.calls.append((method, path, copy.deepcopy(json_body), access_token))
        user = self.tokens.get(access_token)
        if not user:
            return response(401, error={"code": "TOKEN_REVOKED"})
        if path == "/api/auth/me":
            return response(200, data={"user": {"id": user}})
        if path == "/api/airports/search":
            return response(200, data={"airports": [{"iataCode": "PEK"}]})
        if path == "/api/bookings":
            return response(201, data={"booking": {"bookingReference": "BK123"}})
        if path == "/api/sessions":
            if method == "GET":
                return response(200, data={"sessions": [
                    {key: value for key, value in item.items() if key not in {"user", "turns"}}
                    for item in self.sessions.values() if item["user"] == user
                ]})
            session_id = json_body["sessionId"]
            existing = self.sessions.get(session_id)
            if existing and existing["user"] != user:
                return response(409, error={"code": "SESSION_ID_CONFLICT"})
            if not existing:
                self.sessions[session_id] = {
                    "sessionId": session_id, "title": "New conversation",
                    "user": user, "turns": [], "createdAt": "2026-09-20T00:00:00Z",
                    "updatedAt": "2026-09-20T00:00:00Z", "lastAccess": "2026-09-20T00:00:00Z",
                }
            return response(200 if existing else 201, data={"session": {}}, meta={"alreadyExists": bool(existing)})
        parts = path.split("/")
        session = self.sessions.get(parts[3])
        if not session or session["user"] != user:
            if method == "DELETE":
                return response(204)
            return response(404, error={"code": "SESSION_NOT_FOUND"})
        if method == "DELETE":
            del self.sessions[parts[3]]
            return response(204)
        if method == "GET":
            return response(200, data={"session": copy.deepcopy({
                key: value for key, value in session.items() if key != "user"
            })})
        if len(parts) == 5:
            if self.start_failure:
                raise resolution.BackendConnectionError("start unavailable")
            existing = next((turn for turn in session["turns"] if turn["turnId"] == json_body["turnId"]), None)
            if existing:
                return response(200, data={"turn": copy.deepcopy(existing)}, meta={"alreadyExists": True})
            turn = {
                "turnId": json_body["turnId"], "sequence": len(session["turns"]) + 1,
                "status": "pending", "messages": [{"role": "user", "content": json_body["message"]}],
                "view": {"userMessage": json_body["message"], "assistantMessage": None, "events": []},
                "error": None, "createdAt": "2026-09-20T00:00:00Z", "updatedAt": "2026-09-20T00:00:00Z",
            }
            session["turns"].append(turn)
            return response(201, data={"turn": copy.deepcopy(turn)}, meta={"alreadyExists": False})
        failure = self.finish_failures.pop(0) if self.finish_failures else None
        if failure == "before":
            raise resolution.BackendConnectionError("save unavailable")
        if isinstance(failure, int):
            return response(failure, error={"code": "SAVE_ERROR"})
        turn = next(turn for turn in session["turns"] if turn["turnId"] == parts[5])
        messages = copy.deepcopy(json_body["messages"])
        functions = {
            call["id"]: call["function"]["name"] for message in messages
            for call in message.get("tool_calls") or []
        }
        turn.update(status=json_body["status"], messages=messages, error=json_body.get("error"))
        last = messages[-1]
        turn["view"] = {
            "userMessage": messages[0]["content"],
            "assistantMessage": last["content"] if last["role"] == "assistant" and not last.get("tool_calls") else None,
            "events": [
                {"tool": functions[message["tool_call_id"]], "result": json.loads(message["content"])}
                for message in messages if message["role"] == "tool"
            ],
        }
        if failure == "after":
            raise resolution.BackendConnectionError("acknowledgement lost")
        return response(200, data={"turn": copy.deepcopy(turn)}, meta={"alreadyCompleted": False})


class ChatPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.rest = BackendFixture()
        self.backend_patch = patch.object(resolution.BackendClient, "_request", side_effect=self.rest.request)
        self.backend_patch.start()
        self.addCleanup(self.backend_patch.stop)
        self.model = Mock()
        self.model.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            message=ChatCompletionMessage(role="assistant", content="Done", reasoning_content="private reasoning"),
        )])
        self.assistant = resolution.FlightBookingAssistant(
            deepseek_client=SimpleNamespace(chat=SimpleNamespace(completions=self.model)),
            tool_executor=resolution.ToolExecutor(resolution.BackendClient("http://backend")),
        )
        self.assistant_patch = patch.object(middle_app, "_assistant", self.assistant)
        self.assistant_patch.start()
        self.addCleanup(self.assistant_patch.stop)
        self.client = TestClient(middle_app.app)
        self.addCleanup(self.client.close)
        self.session_id = str(uuid.uuid4())
        self.request_id = str(uuid.uuid4())
        self.headers = {"Authorization": "Bearer token"}

    def post(self, *, request_id=None, message="Find airports"):
        return self.client.post("/api/chat", headers=self.headers, json={
            "sessionId": self.session_id, "requestId": request_id or self.request_id, "message": message,
        })

    def turns(self):
        return self.rest.sessions[self.session_id]["turns"]

    def tool_completion(self, name="search_airports", arguments='{"query":"Beijing"}'):
        return SimpleNamespace(choices=[SimpleNamespace(message=ChatCompletionMessage(
            role="assistant", content=None, reasoning_content="Look up exact airport IDs.",
            tool_calls=[{"id": "call-1", "type": "function", "function": {"name": name, "arguments": arguments}}],
        ))])

    def test_start_precedes_model_and_complete_transcript_generates_persisted_events(self):
        final = self.model.create.return_value
        def model_call(**kwargs):
            self.assertEqual(self.turns()[0]["status"], "pending")
            self.assertEqual(self.turns()[0]["messages"], [{"role": "user", "content": "Find airports"}])
            self.assertNotIn("Bearer token", json.dumps(resolution.serialize_messages(kwargs["messages"])))
            return self.tool_completion() if self.model.create.call_count == 1 else final
        self.model.create.side_effect = model_call
        result = self.post()
        self.assertEqual(result.status_code, 200, result.text)
        turn = self.turns()[0]
        self.assertEqual([item["role"] for item in turn["messages"]], ["user", "assistant", "tool", "assistant"])
        self.assertEqual(turn["messages"][1]["reasoning_content"], "Look up exact airport IDs.")
        self.assertEqual(turn["messages"][2]["tool_call_id"], "call-1")
        self.assertEqual(result.json()["events"], turn["view"]["events"])
        self.assertEqual(turn["status"], "completed")
        finish_body = self.rest.calls[-1][2]
        self.assertEqual(set(finish_body), {"status", "messages"})
        self.assertNotIn("system", [item["role"] for item in finish_body["messages"]])

    def test_replay_survives_assistant_reset_without_loading_provider(self):
        first = self.post()
        with patch.object(middle_app, "_assistant", None), patch.object(middle_app, "get_assistant") as factory:
            replay = self.post()
            factory.assert_not_called()
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertTrue(replay.json()["replayed"])
        self.assertEqual(replay.json()["message"], first.json()["message"])
        self.assertEqual(self.model.create.call_count, 1)
        self.assertEqual(self.post(message="Different").json()["detail"]["code"], "TURN_ID_CONFLICT")

    def test_next_turn_restores_full_completed_history_with_new_system_instructions(self):
        self.model.create.side_effect = [self.tool_completion(), self.model.create.return_value]
        self.assertEqual(self.post().status_code, 200)
        transcript = copy.deepcopy(self.turns()[0]["messages"])
        observed = []
        def reply(**kwargs):
            observed.extend(copy.deepcopy(kwargs["messages"]))
            return SimpleNamespace(choices=[SimpleNamespace(message=ChatCompletionMessage(role="assistant", content="Second"))])
        self.model.create.side_effect = reply
        result = self.post(request_id=str(uuid.uuid4()), message="Use the first airport")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(observed[0]["role"], "system")
        self.assertEqual(observed[1:-1], transcript)
        self.assertEqual(observed[-1]["content"], "Use the first airport")
        self.assertEqual(len(self.turns()[1]["messages"]), 2)

    def test_provider_failure_saves_partial_transcript_and_retry_reuses_booking_key(self):
        self.model.create.side_effect = [
            self.tool_completion("create_booking", '{"flight_id":"507f1f77bcf86cd799439011","seat_count":1}'),
            resolution.AssistantResponseError("Provider stopped"),
        ]
        failed = self.post()
        self.assertEqual(failed.status_code, 502, failed.text)
        self.assertEqual(self.turns()[0]["status"], "failed")
        self.assertEqual([item["role"] for item in self.turns()[0]["messages"]], ["user", "assistant", "tool"])
        observed = []
        first = self.tool_completion("create_booking", '{"flight_id":"507f1f77bcf86cd799439011","seat_count":1}')
        final = self.model.create.return_value
        replies = iter([first, final])
        def retry_model(**kwargs):
            observed.append(copy.deepcopy(kwargs["messages"]))
            return next(replies)
        self.model.create.side_effect = retry_model
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.turns()[0]["status"], "completed")
        self.assertEqual(len(self.turns()), 1)
        self.assertFalse(any(item["role"] == "tool" for item in observed[0]))
        booking_calls = [call for call in self.rest.calls if call[1] == "/api/bookings"]
        self.assertEqual([call[2]["idempotencyKey"] for call in booking_calls], [self.request_id] * 2)

    def test_pending_is_not_blindly_reexecuted_and_blocks_followups(self):
        self.rest.finish_failures = ["before", "before"]
        failed = self.post()
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(failed.json()["detail"]["code"], "TURN_SAVE_FAILED")
        self.assertEqual(self.turns()[0]["status"], "pending")
        for request_id in (self.request_id, str(uuid.uuid4())):
            reply = self.post(request_id=request_id)
            self.assertEqual(reply.status_code, 409)
            self.assertEqual(reply.json()["detail"]["code"], "TURN_PENDING")
        self.assertEqual(self.model.create.call_count, 1)
        self.assertEqual(len(self.turns()), 1)

    def test_lost_completion_ack_retries_only_the_identical_write(self):
        self.rest.finish_failures = ["after"]
        result = self.post()
        self.assertEqual(result.status_code, 200, result.text)
        finishes = [call for call in self.rest.calls if call[1].endswith("/finish")]
        self.assertEqual(len(finishes), 2)
        self.assertEqual(finishes[0][2], finishes[1][2])
        self.assertEqual(self.model.create.call_count, 1)

    def test_lost_ack_can_be_recovered_by_a_later_request(self):
        self.rest.finish_failures = ["after", "before"]
        self.assertEqual(self.post().status_code, 503)
        self.assertEqual(self.turns()[0]["status"], "completed")
        self.assertTrue(self.post().json()["replayed"])
        self.assertEqual(self.model.create.call_count, 1)

    def test_start_failure_prevents_model_and_tools(self):
        self.rest.start_failure = True
        self.assertEqual(self.post().status_code, 503)
        self.model.create.assert_not_called()

    def test_session_restoration_returns_views_and_delete_uses_backend(self):
        self.assertEqual(self.post().status_code, 200)
        listing = self.client.get("/api/chat/sessions", headers=self.headers)
        self.assertEqual(listing.json()["data"]["sessions"][0]["sessionId"], self.session_id)
        detail = self.client.get(f"/api/chat/sessions/{self.session_id}", headers=self.headers)
        restored = detail.json()["data"]["session"]["turns"][0]
        self.assertEqual(restored["view"], self.turns()[0]["view"])
        self.assertNotIn("messages", restored)
        self.assertNotIn("private reasoning", detail.text)
        self.assertEqual(self.client.delete(f"/api/chat/{self.session_id}", headers=self.headers).status_code, 204)
        self.assertNotIn(self.session_id, self.rest.sessions)
        self.assertEqual(self.client.get(f"/api/chat/sessions/{self.session_id}", headers=self.headers).status_code, 404)

    def test_authentication_and_ownership_apply_to_replay_restore_and_delete(self):
        self.assertEqual(self.post().status_code, 200)
        routes = [("get", "/api/chat/sessions"), ("get", f"/api/chat/sessions/{self.session_id}"),
                  ("delete", f"/api/chat/{self.session_id}")]
        for method, route in routes:
            self.assertEqual(getattr(self.client, method)(route).status_code, 401)
        self.rest.tokens.pop("token")
        self.assertEqual(self.post().status_code, 401)
        for method, route in routes:
            self.assertEqual(getattr(self.client, method)(route, headers=self.headers).status_code, 401)
        other = {"Authorization": "Bearer other"}
        self.assertEqual(self.client.get("/api/chat/sessions", headers=other).json()["data"]["sessions"], [])
        self.assertEqual(self.client.get(f"/api/chat/sessions/{self.session_id}", headers=other).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/chat/{self.session_id}", headers=other).status_code, 204)
        self.assertIn(self.session_id, self.rest.sessions)
        self.assertEqual(self.model.create.call_count, 1)

    def test_concurrent_retries_run_one_model_and_do_not_retain_locks(self):
        entered, release = threading.Event(), threading.Event()
        final = self.model.create.return_value
        def reply(**_kwargs):
            entered.set()
            self.assertTrue(release.wait(5))
            return final
        self.model.create.side_effect = reply
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.post)
            self.assertTrue(entered.wait(5))
            second = pool.submit(self.post)
            release.set()
            responses = [first.result(timeout=10), second.result(timeout=10)]
        self.assertEqual([item.status_code for item in responses], [200, 200])
        self.assertEqual(sorted(item.json()["replayed"] for item in responses), [False, True])
        self.assertEqual(self.model.create.call_count, 1)
        self.assertEqual(len(middle_app._session_locks), 0)

    def test_failed_old_turn_cannot_be_reinserted_before_later_context(self):
        self.model.create.side_effect = resolution.AssistantResponseError("Failure")
        self.assertEqual(self.post().status_code, 502)
        self.model.create.side_effect = None
        self.assertEqual(self.post(request_id=str(uuid.uuid4()), message="Another question").status_code, 200)
        rejected = self.post()
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()["detail"]["code"], "TURN_RETRY_OUT_OF_ORDER")
        self.assertEqual(self.model.create.call_count, 2)


if __name__ == "__main__":
    unittest.main()
