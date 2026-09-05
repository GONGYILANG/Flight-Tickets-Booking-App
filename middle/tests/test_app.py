from __future__ import annotations

import unittest
import uuid
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

try:
    from middle import app as middle_app
except ImportError:
    import app as middle_app  # type: ignore[no-redef]


class FakeAssistant:
    @staticmethod
    def new_history() -> list[dict[str, str]]:
        return [{"role": "system", "content": "test"}]


class SessionStoreTests(unittest.TestCase):
    def test_cached_reply_keeps_tool_events_for_idempotent_replay(self) -> None:
        store = middle_app.SessionStore(max_sessions=1, ttl_seconds=60)
        state = store.get_or_create(uuid.uuid4(), FakeAssistant(), "user-a")
        events = [{"tool": "search_flights", "result": {"ok": True, "status": 200}}]

        store.cache_reply(state, "request", "find flights", "found one", events)
        events.clear()

        cached = state.replies["request"]
        self.assertEqual(cached.assistant_message, "found one")
        self.assertEqual(cached.events[0]["tool"], "search_flights")

    def test_sessions_and_deletion_are_scoped_to_the_verified_user(self) -> None:
        store = middle_app.SessionStore()
        session_id = uuid.uuid4()
        alice = store.get_or_create(session_id, FakeAssistant(), "alice")
        bob = store.get_or_create(session_id, FakeAssistant(), "bob")
        self.assertIsNot(alice, bob)
        self.assertFalse(store.delete(session_id, "other-user"))
        self.assertTrue(store.delete(session_id, "bob"))
        self.assertIs(store.get_or_create(session_id, FakeAssistant(), "alice"), alice)

    def test_missing_and_revoked_tokens_cannot_reach_cached_replies(self) -> None:
        with self.assertRaises(HTTPException) as missing:
            middle_app.current_user_id(None)
        self.assertEqual(missing.exception.status_code, 401)
        with patch.object(middle_app.BackendClient, "get_me") as get_me:
            get_me.return_value.status_code = 401
            get_me.return_value.body = {"error": {"code": "TOKEN_REVOKED"}}
            with self.assertRaises(HTTPException) as revoked:
                middle_app.current_user_id(HTTPAuthorizationCredentials(scheme="Bearer", credentials="revoked"))
            self.assertEqual(revoked.exception.detail["code"], "TOKEN_REVOKED")

    def test_http_chat_rechecks_auth_before_replay_and_delete(self) -> None:
        assistant = Mock()
        assistant.new_history.return_value = []
        assistant.respond.return_value = "Found a flight"
        session_id = str(uuid.uuid4())
        body = {"sessionId": session_id, "requestId": str(uuid.uuid4()), "message": "find flights"}
        headers = {"Authorization": "Bearer token"}
        with patch.object(middle_app, "_assistant", assistant), \
             patch.object(middle_app, "SESSION_STORE", middle_app.SessionStore()), \
             patch.object(middle_app.BackendClient, "get_me") as get_me, \
             TestClient(middle_app.app) as client:
            self.assertEqual(client.post("/api/chat", json=body).status_code, 401)
            get_me.return_value.status_code = 200
            get_me.return_value.body = {"data": {"user": {"id": "alice"}}}
            self.assertEqual(client.post("/api/chat", json=body, headers=headers).status_code, 200)
            self.assertTrue(client.post("/api/chat", json=body, headers=headers).json()["replayed"])
            self.assertEqual(assistant.respond.call_count, 1)
            get_me.return_value.status_code = 401
            get_me.return_value.body = {"error": {"code": "TOKEN_REVOKED"}}
            self.assertEqual(client.post("/api/chat", json=body, headers=headers).status_code, 401)
            self.assertEqual(client.delete(f"/api/chat/{session_id}", headers=headers).status_code, 401)
            self.assertEqual(assistant.respond.call_count, 1)


if __name__ == "__main__":
    unittest.main()
