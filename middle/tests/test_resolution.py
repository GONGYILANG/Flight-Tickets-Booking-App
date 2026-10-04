from __future__ import annotations

import json
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

try:
    from middle import resolution
except ImportError:
    import resolution  # type: ignore[no-redef]


FLIGHT_ID = "66a1b2c3d4e5f67890123456"
BOOKING_ID = "66a1b2c3d4e5f67890123499"


class FakeBackend:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def search_airports(self, query: str, limit: int, match: str) -> resolution.BackendResponse:
        self.calls.append(("search_airports", query, limit, match))
        return resolution.BackendResponse(
            200, {"data": {"airports": [{"iataCode": "PEK"}]}}
        )

    def search_flights(self, criteria: dict, *, departure_date_from: str, departure_date_to: str) -> resolution.BackendResponse:
        self.calls.append(("search_flights", {
            **criteria, "departureDateFrom": departure_date_from, "departureDateTo": departure_date_to,
        }))
        return resolution.BackendResponse(200, {"data": {"flights": []}})

    def get_flight(self, flight_id: str) -> resolution.BackendResponse:
        self.calls.append(("get_flight", flight_id))
        return resolution.BackendResponse(
            200, {"data": {"flight": {"id": flight_id}}}
        )

    def create_booking(
        self,
        flight_id: str,
        seat_count: int,
        idempotency_key: str,
        access_token: str,
    ) -> resolution.BackendResponse:
        self.calls.append(
            (
                "create_booking",
                flight_id,
                seat_count,
                idempotency_key,
                access_token,
            )
        )
        return resolution.BackendResponse(
            201,
            {
                "data": {
                    "booking": {
                        "id": BOOKING_ID,
                        "bookingReference": "BK1A2B3C4D5E6",
                    }
                }
            },
        )

    def list_my_bookings(
        self, page: int, limit: int, access_token: str
    ) -> resolution.BackendResponse:
        self.calls.append(("list_my_bookings", page, limit, access_token))
        return resolution.BackendResponse(200, {"data": {"bookings": []}})

    def cancel_booking(
        self, booking_id: str, access_token: str
    ) -> resolution.BackendResponse:
        self.calls.append(("cancel_booking", booking_id, access_token))
        return resolution.BackendResponse(200, {"data": {"booking": {}}})


class FakeHTTPResponse:
    def __init__(self, status: int, body: dict) -> None:
        self.status = status
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self) -> "FakeHTTPResponse":
        return self

    def __exit__(self, *_args) -> None:
        return None

    def read(self) -> bytes:
        return self.body

    def getcode(self) -> int:
        return self.status


class ToolSchemaTests(unittest.TestCase):
    def test_every_strict_schema_requires_every_property(self) -> None:
        for tool in resolution.TOOLS:
            function = tool["function"]
            parameters = function["parameters"]
            with self.subTest(tool=function["name"]):
                self.assertTrue(function["strict"])
                self.assertFalse(parameters["additionalProperties"])
                self.assertEqual(
                    set(parameters["properties"]), set(parameters["required"])
                )


class BackendClientTests(unittest.TestCase):
    def test_flight_tool_sends_one_range_request_and_preserves_pagination(self) -> None:
        client = resolution.BackendClient("http://localhost:3000")
        executor = resolution.ToolExecutor(client)
        context = resolution.RequestContext(access_token=None, request_id=str(uuid.uuid4()))
        for first, last, page in [("2026-12-08", "2026-12-08", 1), ("2026-12-01", "2026-12-31", 2),
                                  ("2028-02-01", "2028-02-29", 3), ("2026-12-20", "2027-01-05", 5)]:
            data = {"flights": [], "pagination": {"page": page, "limit": 5, "totalItems": 25, "totalPages": 5}}
            with self.subTest(first=first, last=last, page=page), patch(
                f"{resolution.__name__}.urlopen", return_value=FakeHTTPResponse(200, {"data": data}),
            ) as urlopen:
                result = executor.execute("search_flights", json.dumps({
                    "origin": "PEK", "destination": "HKG", "departure_date_from": first,
                    "departure_date_to": last, "departure_period": "MORNING", "airline_code": "CX",
                    "passengers": 2, "page": page, "sort_by": "departureAt", "sort_order": "asc",
                }), context)
                self.assertTrue(result["ok"])
                self.assertEqual(result["data"], data)
                urlopen.assert_called_once()
                request = urlopen.call_args.args[0]
                self.assertEqual(request.method, "GET")
                url = urlparse(request.full_url)
                self.assertEqual(url.path, "/api/flights/search")
                self.assertEqual(parse_qs(url.query), {
                    "origin": ["PEK"], "destination": ["HKG"], "departureDateFrom": [first],
                    "departureDateTo": [last], "departurePeriod": ["MORNING"], "airlineCode": ["CX"],
                    "passengers": ["2"], "sortBy": ["departureAt"], "sortOrder": ["asc"],
                    "page": [str(page)], "limit": ["5"],
                })

    def test_airport_tool_forwards_explicit_match_mode_and_rejects_invalid_modes(self) -> None:
        client = resolution.BackendClient("http://localhost:3000")
        executor = resolution.ToolExecutor(client)
        context = resolution.RequestContext(access_token=None, request_id=str(uuid.uuid4()))
        for query, match in (("SHA", "exact"), ("Pudong", "fuzzy"), ("Bei", "fuzzy")):
            with self.subTest(query=query, match=match), patch(
                f"{resolution.__name__}.urlopen",
                return_value=FakeHTTPResponse(200, {"data": {"airports": []}}),
            ) as urlopen:
                result = executor.execute("search_airports", json.dumps({"query": query, "match": match}), context)
                self.assertTrue(result["ok"])
                self.assertEqual(urlopen.call_args.args[0].full_url,
                                 f"http://localhost:3000/api/airports/search?q={query}&limit=5&match={match}")
        for invalid in ("unknown", None, 1):
            with self.subTest(match=invalid), patch(f"{resolution.__name__}.urlopen") as urlopen:
                result = executor.execute("search_airports", json.dumps({"query": "Pudong", "match": invalid}), context)
                self.assertEqual(result["error"]["code"], "INVALID_TOOL_ARGUMENTS")
                urlopen.assert_not_called()

    def test_session_endpoints_forward_ids_bodies_and_bearer_tokens(self) -> None:
        client = resolution.BackendClient("http://localhost:3000")
        session_id, turn_id = str(uuid.uuid4()), str(uuid.uuid4())
        messages = [{"role": "user", "content": "Hello"}]
        base = f"/api/sessions/{session_id}"
        cases = [
            (lambda: client.create_session(session_id, "jwt"), "POST", "/api/sessions", {"sessionId": session_id}),
            (lambda: client.list_sessions("jwt"), "GET", "/api/sessions", None),
            (lambda: client.get_session(session_id, "jwt"), "GET", base, None),
            (lambda: client.start_turn(session_id, turn_id, "Hello", "jwt"), "POST", base + "/turns",
             {"turnId": turn_id, "message": "Hello"}),
            (lambda: client.finish_turn(session_id, turn_id, messages, "jwt", status="failed", error="Stopped"),
             "POST", base + f"/turns/{turn_id}/finish", {"status": "failed", "messages": messages, "error": "Stopped"}),
            (lambda: client.delete_session(session_id, "jwt"), "DELETE", base, None),
        ]
        for invoke, method, path, body in cases:
            with self.subTest(method=method, path=path), patch(
                f"{resolution.__name__}.urlopen", return_value=FakeHTTPResponse(200, {}),
            ) as urlopen:
                invoke()
                request = urlopen.call_args.args[0]
                self.assertEqual(request.full_url, "http://localhost:3000" + path)
                self.assertEqual(request.method, method)
                self.assertEqual(request.headers["Authorization"], "Bearer jwt")
                self.assertEqual(json.loads(request.data) if request.data else None, body)

    def test_create_booking_maps_body_and_authorization(self) -> None:
        client = resolution.BackendClient("http://localhost:3000")
        response = FakeHTTPResponse(201, {"data": {"booking": {}}})
        target = f"{resolution.__name__}.urlopen"

        with patch(target, return_value=response) as mocked_urlopen:
            result = client.create_booking(
                FLIGHT_ID, 2, "31fd68ab-edc2-4dc7-a4ea-a0bc4c351d2f", "jwt-value"
            )

        self.assertEqual(result.status_code, 201)
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://localhost:3000/api/bookings")
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.headers["Authorization"], "Bearer jwt-value")
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {
                "flightId": FLIGHT_ID,
                "seatCount": 2,
                "source": "AI",
                "idempotencyKey": "31fd68ab-edc2-4dc7-a4ea-a0bc4c351d2f",
            },
        )


class ToolExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.backend = FakeBackend()
        self.executor = resolution.ToolExecutor(self.backend)
        self.context = resolution.RequestContext(
            access_token="jwt-secret", request_id=str(uuid.uuid4())
        )

    def test_search_flights_normalizes_and_omits_any_filters(self) -> None:
        arguments = {
            "origin": "pek",
            "destination": "hkg",
            "departure_date_from": "2026-12-08",
            "departure_date_to": "2026-12-08",
            "departure_period": "ANY",
            "airline_code": "",
            "passengers": 2,
            "page": 1,
            "sort_by": "price",
            "sort_order": "asc",
        }

        result = self.executor.execute(
            "search_flights", json.dumps(arguments), self.context
        )

        self.assertTrue(result["ok"])
        criteria = self.backend.calls[0][1]
        self.assertEqual(criteria["origin"], "PEK")
        self.assertEqual(criteria["destination"], "HKG")
        self.assertEqual(criteria["departureDateFrom"], "2026-12-08")
        self.assertEqual(criteria["departureDateTo"], "2026-12-08")
        self.assertNotIn("departureDate", criteria)
        self.assertEqual(criteria["page"], 1)
        self.assertEqual(criteria["limit"], 5)
        self.assertNotIn("departurePeriod", criteria)
        self.assertNotIn("airlineCode", criteria)

    def test_invalid_date_ranges_are_rejected_before_http(self) -> None:
        arguments = {
            "origin": "PEK",
            "destination": "HKG",
            "departure_date_from": "2026-12-01",
            "departure_date_to": "2026-12-31",
            "departure_period": "ANY",
            "airline_code": "",
            "passengers": 1,
            "page": 1,
            "sort_by": "departureAt",
            "sort_order": "asc",
        }

        for changes in [
            {"departure_date_from": "2026-02-30"},
            {"departure_date_to": "2026-12-32"},
            {"departure_date_from": "2026-12"},
            {"departure_date_from": None},
            {"departure_date_to": ["2026-12-31"]},
            {"departure_date_to": "2026-11-30"},
            {"departure_date_to": "2027-01-01"},
            {"departure_date": "2026-12-08"},
        ]:
            with self.subTest(changes=changes):
                result = self.executor.execute(
                    "search_flights", json.dumps({**arguments, **changes}), self.context
                )
                self.assertEqual(result["error"]["code"], "INVALID_TOOL_ARGUMENTS")
        del arguments["departure_date_to"]
        result = self.executor.execute("search_flights", json.dumps(arguments), self.context)
        self.assertEqual(result["error"]["code"], "INVALID_TOOL_ARGUMENTS")
        self.assertEqual(self.backend.calls, [])

    def test_flight_page_is_required_and_validated_before_http(self) -> None:
        arguments = {
            "origin": "PEK", "destination": "HKG",
            "departure_date_from": "2026-12-01", "departure_date_to": "2026-12-31",
            "departure_period": "ANY", "airline_code": "", "passengers": 1,
            "sort_by": "price", "sort_order": "asc",
        }
        for page in [0, -1, 10001, True, "2", 1.5, None]:
            with self.subTest(page=page):
                result = self.executor.execute(
                    "search_flights", json.dumps({**arguments, "page": page}), self.context
                )
                self.assertEqual(result["error"]["code"], "INVALID_TOOL_ARGUMENTS")
                self.assertIn("page", result["error"]["message"])
        result = self.executor.execute("search_flights", json.dumps(arguments), self.context)
        self.assertEqual(result["error"]["code"], "INVALID_TOOL_ARGUMENTS")
        self.assertEqual(self.backend.calls, [])

        result = self.executor.execute(
            "search_flights", json.dumps({**arguments, "page": 10000}), self.context
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.backend.calls[0][1]["page"], 10000)
        self.assertEqual(self.backend.calls[0][1]["limit"], 5)

    def test_protected_tool_without_token_returns_auth_required(self) -> None:
        context = resolution.RequestContext(
            access_token=None, request_id=str(uuid.uuid4())
        )
        result = self.executor.execute(
            "list_my_bookings", '{"page":1}', context
        )

        self.assertEqual(result["status"], 401)
        self.assertEqual(result["error"]["code"], "AUTH_REQUIRED")
        self.assertEqual(self.backend.calls, [])

    def test_list_bookings_keeps_page_and_uses_fixed_limit(self) -> None:
        result = self.executor.execute(
            "list_my_bookings", '{"page":3}', self.context
        )

        self.assertTrue(result["ok"])
        self.assertEqual(
            self.backend.calls,
            [("list_my_bookings", 3, 10, "jwt-secret")],
        )

    def test_booking_key_is_the_request_id_regardless_of_tool_arguments(self) -> None:
        arguments = json.dumps({"flight_id": FLIGHT_ID, "seat_count": 2})
        changed_arguments = json.dumps({"flight_id": FLIGHT_ID, "seat_count": 3})

        first = self.executor.execute("create_booking", arguments, self.context)
        second = self.executor.execute("create_booking", changed_arguments, self.context)
        next_context = resolution.RequestContext(
            access_token="jwt-secret", request_id=str(uuid.uuid4())
        )
        third = self.executor.execute("create_booking", arguments, next_context)

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertTrue(third["ok"])
        keys = [call[3] for call in self.backend.calls]
        self.assertEqual(keys[0], keys[1])
        self.assertEqual(keys[0], self.context.request_id)
        self.assertNotEqual(keys[0], keys[2])
        self.assertEqual(keys[2], next_context.request_id)

    def test_extra_model_field_is_rejected(self) -> None:
        result = self.executor.execute(
            "search_airports",
            '{"query":"Beijing","match":"fuzzy","unexpected":true}',
            self.context,
        )

        self.assertEqual(result["error"]["code"], "INVALID_TOOL_ARGUMENTS")
        self.assertIn("unexpected fields", result["error"]["message"])
        self.assertEqual(self.backend.calls, [])


class FakeCompletions:
    def __init__(self, messages: list[SimpleNamespace]) -> None:
        self.messages = list(messages)
        self.requests: list[dict] = []

    def create(self, **kwargs) -> SimpleNamespace:
        self.requests.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=self.messages.pop(0))])


class AssistantLoopTests(unittest.TestCase):
    def test_booking_attempt_is_limited_across_batches_and_resets_next_turn(self) -> None:
        arguments = json.dumps({"flight_id": FLIGHT_ID, "seat_count": 1})

        def call(call_id: str, name: str, args: str) -> SimpleNamespace:
            return SimpleNamespace(
                id=call_id, function=SimpleNamespace(name=name, arguments=args)
            )

        for first_arguments in (arguments, "invalid JSON"):
            with self.subTest(first_arguments=first_arguments):
                final = SimpleNamespace(content="Done", tool_calls=None)
                completions = FakeCompletions([
                    SimpleNamespace(content=None, tool_calls=[
                        call("first", "create_booking", first_arguments),
                        call("same_batch", "create_booking", arguments),
                        call("lookup", "list_my_bookings", '{"page":1}'),
                    ]),
                    SimpleNamespace(content=None, tool_calls=[
                        call("next_batch", "create_booking", arguments),
                    ]),
                    final,
                    SimpleNamespace(content=None, tool_calls=[
                        call("next_turn", "create_booking", arguments),
                    ]),
                    final,
                ])
                backend = FakeBackend()
                assistant = resolution.FlightBookingAssistant(
                    deepseek_client=SimpleNamespace(chat=SimpleNamespace(completions=completions)),
                    tool_executor=resolution.ToolExecutor(backend),
                )
                history = assistant.new_history()
                assistant.respond(history, "Confirm booking", access_token="token",
                                  request_id=str(uuid.uuid4()))

                first_count = int(first_arguments == arguments)
                self.assertEqual(sum(item[0] == "create_booking" for item in backend.calls), first_count)
                replies = [item for item in history if isinstance(item, dict) and item.get("role") == "tool"]
                self.assertEqual([item["tool_call_id"] for item in replies],
                                 ["first", "same_batch", "lookup", "next_batch"])

                assistant.respond(history, "Confirm another booking", access_token="token",
                                  request_id=str(uuid.uuid4()))
                self.assertEqual(sum(item[0] == "create_booking" for item in backend.calls), first_count + 1)

    def test_default_model_matches_environment_bootstrap_and_allows_override(self) -> None:
        direct = resolution.FlightBookingAssistant(deepseek_client=None, tool_executor=None)
        self.assertEqual(direct.model, "deepseek-flash")
        for model in (None, "custom-model"):
            env = {"DEEPSEEK_API_KEY": "test-key"}
            if model is not None:
                env["DEEPSEEK_MODEL"] = model
            with patch.dict(resolution.os.environ, env, clear=True), \
                 patch("dotenv.load_dotenv"), patch.object(resolution, "OpenAI"):
                assistant = resolution.build_assistant_from_env()
                self.assertEqual(assistant.model, model or direct.model)

    def test_tool_result_is_replayed_and_token_is_not_sent_to_model(self) -> None:
        tool_call = SimpleNamespace(
            id="call_airport_1",
            function=SimpleNamespace(
                name="search_airports",
                arguments='{"query":"Beijing","match":"fuzzy"}',
            ),
        )
        tool_message = SimpleNamespace(
            content=None,
            reasoning_content="Need to resolve the airport.",
            tool_calls=[tool_call],
        )
        final_message = SimpleNamespace(
            content="北京有两个机场，请选择 PEK 或 PKX。",
            reasoning_content=None,
            tool_calls=None,
        )
        completions = FakeCompletions([tool_message, final_message])
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=completions)
        )
        backend = FakeBackend()
        assistant = resolution.FlightBookingAssistant(
            deepseek_client=client,
            tool_executor=resolution.ToolExecutor(backend),
        )
        history = assistant.new_history(
            datetime(2026, 8, 24, tzinfo=timezone.utc)
        )

        reply = assistant.respond(
            history,
            "北京飞香港",
            access_token="must-not-reach-deepseek",
            request_id=str(uuid.uuid4()),
        )

        self.assertEqual(reply, "北京有两个机场，请选择 PEK 或 PKX。")
        self.assertEqual(len(completions.requests), 2)
        second_messages = completions.requests[1]["messages"]
        tool_results = [
            item for item in second_messages if isinstance(item, dict) and item.get("role") == "tool"
        ]
        self.assertEqual(len(tool_results), 1)
        self.assertNotIn("must-not-reach-deepseek", json.dumps(second_messages, default=str))
        self.assertIs(second_messages[2], tool_message)
        self.assertEqual(backend.calls, [("search_airports", "Beijing", 5, "fuzzy")])


if __name__ == "__main__":
    unittest.main()
