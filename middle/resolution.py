"""DeepSeek tool-calling orchestration for the flight-booking middle layer.

The module deliberately keeps three responsibilities separate:

* :class:`BackendClient` performs HTTP requests to the existing REST backend.
* :class:`ToolExecutor` validates model-produced JSON before calling that client.
* :class:`FlightBookingAssistant` runs the DeepSeek tool-calling loop.

Authentication tokens are carried only in ``RequestContext``. They are never
added to the model conversation or to a tool result.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone as datetime_timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from openai import OpenAI
except ImportError:  # Lets the standard-library unit tests run before install.
    OpenAI = None  # type: ignore[assignment]


LOGGER = logging.getLogger(__name__)
DEFAULT_MODEL = "deepseek-flash"

OBJECT_ID_PATTERN = re.compile(r"^[0-9a-fA-F]{24}$")
IATA_PATTERN = re.compile(r"^[A-Z]{3}$")
AIRLINE_PATTERN = re.compile(r"^[A-Z0-9]{2,3}$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _load_timezone(name: str) -> Any:
    """Load an IANA timezone, with small fixed-offset fallbacks for bootstrap."""

    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as error:
        # Windows Python does not ship an IANA database. ``tzdata`` is listed in
        # requirements.txt, while these two fallbacks keep core tests runnable
        # before dependencies are installed.
        fallbacks = {
            "UTC": datetime_timezone.utc,
            "Asia/Singapore": datetime_timezone(
                timedelta(hours=8), name="Asia/Singapore"
            ),
        }
        if name in fallbacks:
            return fallbacks[name]
        raise ConfigurationError(
            f"MIDDLE_TIMEZONE is not a valid IANA timezone: {name}"
        ) from error


def _strict_tool(
    name: str,
    description: str,
    properties: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Build a DeepSeek strict-mode tool with every property required."""

    return {
        "type": "function",
        "function": {
            "name": name,
            "strict": True,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": list(properties),
                "additionalProperties": False,
            },
        },
    }


TOOLS: list[dict[str, Any]] = [
    _strict_tool(
        "search_airports",
        (
            "Search airports by IATA code, airport name, or city name. Use this "
            "before searching flights whenever the user gives a city or airport "
            "name rather than one unambiguous three-letter IATA code. "
        ),
        {
            "query": {
                "type": "string",
                "description": "English city/airport name or distinctive fragment, or an IATA code.",
            },
            "match": {
                "type": "string",
                "enum": ["fuzzy", "exact"],
                "description": "fuzzy for city/airport names and fragments; exact for IATA codes.",
            },
        },
    ),
    _strict_tool(
        "search_flights",
        (
            "Search bookable direct flights after origin and destination have "
            "been resolved to exact IATA codes. All fields are required by strict "
            "mode; use ANY or an empty airline_code when no filter is requested."
        ),
        {
            "origin": {
                "type": "string",
                "pattern": "^[A-Z]{3}$",
                "description": "Origin airport IATA code, for example PEK.",
            },
            "destination": {
                "type": "string",
                "pattern": "^[A-Z]{3}$",
                "description": "Destination airport IATA code, for example HKG.",
            },
            "departure_date_from": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
                "description": "First departure airport local date, inclusive, in YYYY-MM-DD form. "
                "For one exact date, set both date fields to that date.",
            },
            "departure_date_to": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
                "description": "Last departure airport local date, inclusive, in YYYY-MM-DD form. "
                "Must be on or after departure_date_from, with at most 31 calendar days "
                "including both endpoints.",
            },
            "departure_period": {
                "type": "string",
                "enum": ["ANY", "MORNING", "AFTERNOON"],
                "description": "ANY for the full day, otherwise the local half-day.",
            },
            "airline_code": {
                "type": "string",
                "pattern": "^$|^[A-Z0-9]{2,3}$",
                "description": "Airline code, or an empty string for any airline.",
            },
            "passengers": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9,
                "description": "Number of seats required.",
            },
            "page": {
                "type": "integer",
                "minimum": 1,
                "maximum": 10000,
                "description": "Result page, starting at 1. Request another page only as needed, " 
                "preserving the search filters and sort order. Each page contains up to 5 flights.",
            },
            "sort_by": {
                "type": "string",
                "enum": ["departureAt", "arrivalAt", "availableSeats", "price"],
                "description": "Use price when the user asks for the cheapest fare.",
            },
            "sort_order": {
                "type": "string",
                "enum": ["asc", "desc"],
                "description": "Sort direction.",
            },
        },
    ),
    _strict_tool(
        "get_flight",
        "Load one flight's current details before confirming a booking.",
        {
            "flight_id": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{24}$",
                "description": "The exact flight ObjectId returned by the backend.",
            },
        },
    ),
    _strict_tool(
        "create_booking",
        (
            "Create a booking. Call only after the user explicitly confirms the "
            "exact flight and seat count. The middle layer supplies source=AI and "
            "the idempotency key; never ask the user for either value."
        ),
        {
            "flight_id": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{24}$",
                "description": "The exact flight ObjectId the user confirmed.",
            },
            "seat_count": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9,
                "description": "The exact number of seats the user confirmed.",
            },
        },
    ),
    _strict_tool(
        "list_my_bookings",
        "List the authenticated user's bookings, including IDs used for cancellation.",
        {
            "page": {
                "type": "integer",
                "minimum": 1,
                "maximum": 10000,
                "description": "Result page, normally 1.",
            },
        },
    ),
    _strict_tool(
        "cancel_booking",
        (
            "Cancel an authenticated user's booking. Call only after identifying "
            "the exact booking and receiving explicit cancellation confirmation."
        ),
        {
            "booking_id": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{24}$",
                "description": "The exact booking ObjectId the user confirmed.",
            },
        },
    ),
]


SYSTEM_PROMPT_TEMPLATE = """You are a flight search and booking assistant. Today is {today};
interpret relative dates in {timezone}.

Follow these rules:
1. Resolve city or airport names with search_airports before searching flights.
 Reuse locations already resolved in the conversation.
   - Translate city names into English and search with match=fuzzy. For an informal or partial airport
     name, use a distinctive English keyword or common transliteration, such as Pudong.
     Use match=exact for an explicit 3-letter IATA code, never infer code intent from query length
     or abbreviate a city name or airport name into a guessed code.
   - Query each unresolved location once per batch, then inspect the results. Origin and
     destination may share a batch; alternative names or codes for the same location must not.
   - Check candidates' cityName and name against the city or airport the user mentioned; a nonempty
     fuzzy result alone does not resolve the location. Reuse a single relevant candidate;
     if multiple candidates remain, ask the user to choose and end the reply.
     Do not search for additional airports from general knowledge.
   - After empty or irrelevant name results, try a justified shorter name, common spelling, or
     translation correction. If still unresolved, ask which city or airport the user means
     in the user's language. Do not cycle through guesses.
   - If an explicit IATA code has no exact match, report it as unlisted and ask for clarification.
     End the reply without further airport queries; do not infer a city or substitute another airport.
   - Describe results as airports listed in this system, not every airport in a city or
     proof of bookable flights. Only search_flights establishes flight availability.
2. Never invent airport IATA codes, flight_id, booking_id, prices, seat availability, or booking status.
 Use tool results for these facts.
3. Flight search defaults: departure_period=ANY, airline_code empty, passengers=1, page=1,
 sort_by=price and sort_order=asc.
   - Use departure_date_from and departure_date_to for every search. For one exact date,
     set both to that date. For a month, use its first and last calendar dates, for example
     December 2026 is 2026-12-01 through 2026-12-31. Dates use the departure airport's timezone.
   - Search a time window as a range, not once per day. The inclusive range must be 1 to 31 days;
     ask the user to narrow a longer or unclear window rather than silently truncating it.
   - Results contain up to 5 flights on the requested page, sorted across the entire range,
     not one per day. When the user asks for more, preserve all search filters and sorting
     and request pagination.page + 1 only if pagination.page < pagination.totalPages.
     Reset page to 1 when filters or sorting change. Do not fetch every page by default;
     use filtering and sorting to answer questions such as the cheapest flight.
     Use pagination.totalItems for the total; never imply that this page covers every date
     or every matching flight. When more results exist, point to the table's page controls.
     Table pagination does not enter your history. If a user refers to an unseen page or an
     ambiguous row, ask them to select the flight in the table. Use get_flight for the selected ID
     before presenting its current details; selection alone is not booking confirmation.
4. Booking rules:
   - Show the exact flight, date, times, price, and seat count and obtain explicit confirmation
     before create_booking. A price inquiry, candidate selection, or vague agreement is not confirmation.
   - A turn spans one user message through the final reply, including all tool calls and corresponding
     tool results.
     Attempt create_booking at most once per turn, including failed, timed-out, or invalid-argument attempts.
     Never batch multiple create_booking calls or retry in a later batch of the same turn.
   - If the user requests multiple bookings, ask them to choose one for this turn;
     handle the others in later turns with separate confirmation.
   - After success, report the booking reference, total price, and status.
     After failure, explain the error; do not retry with changed arguments or book another flight in this turn.
   - After a timeout, network error, or uncertain submission, say the booking outcome is unconfirmed.
     You may check list_my_bookings, but do not declare failure or suggest booking again without checking.
5. Before cancel_booking, identify the exact booking and obtain explicit cancellation confirmation.
 Use list_my_bookings to find it when needed.
6. Explain tool failures using error.code and message; never claim success after failure.
 On cancellation success, indicate whether the booking was already cancelled.
7. Reply concisely in the user's language. Number flight results and retain enough identifying details
 to resolve later requests such as "book the first one".
"""


class ConfigurationError(RuntimeError):
    """Raised when required middle-layer configuration is missing."""


class BackendConnectionError(RuntimeError):
    """Raised when the REST backend cannot be reached or decoded."""


class ToolInputError(ValueError):
    """Raised when model-produced tool arguments fail local validation."""


class AssistantResponseError(RuntimeError):
    """Raised when DeepSeek does not produce a usable final response."""


class ToolLoopLimitError(RuntimeError):
    """Raised when the model exceeds the configured number of tool rounds."""


@dataclass(frozen=True)
class BackendResponse:
    """An HTTP status code and parsed JSON body returned by the backend."""

    status_code: int
    body: Any


@dataclass(frozen=True)
class RequestContext:
    """Per-request secrets and identifiers that must not enter LLM messages."""

    access_token: str | None
    request_id: str


class BackendClient:
    """Small JSON client matching the REST endpoints in ``api-reference.md``."""

    def __init__(self, base_url: str, timeout_seconds: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        if not self.base_url.startswith(("http://", "https://")):
            raise ConfigurationError("BACKEND_BASE_URL must be an HTTP(S) URL")
        if timeout_seconds <= 0:
            raise ConfigurationError("BACKEND_TIMEOUT_SECONDS must be positive")
        self.timeout_seconds = timeout_seconds

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        access_token: str | None = None,
    ) -> BackendResponse:
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urlencode(query)}"

        body_bytes = None
        headers = {"Accept": "application/json"}
        if json_body is not None:
            body_bytes = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"

        request = Request(url, data=body_bytes, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw_body = response.read()
                status_code = response.getcode()
        except HTTPError as error:
            raw_body = error.read()
            status_code = error.code
        except (URLError, TimeoutError, OSError) as error:
            raise BackendConnectionError(
                "The flight-booking backend is currently unreachable"
            ) from error

        if not raw_body:
            parsed_body: Any = {}
        else:
            try:
                parsed_body = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise BackendConnectionError(
                    "The flight-booking backend returned invalid JSON"
                ) from error

        return BackendResponse(status_code=status_code, body=parsed_body)

    def health(self) -> BackendResponse:
        return self._request("GET", "/api/health")

    def get_me(self, access_token: str) -> BackendResponse:
        return self._request("GET", "/api/auth/me", access_token=access_token)

    def create_session(self, session_id: str, access_token: str) -> BackendResponse:
        return self._request(
            "POST", "/api/sessions", json_body={"sessionId": session_id},
            access_token=access_token,
        )

    def list_sessions(self, access_token: str) -> BackendResponse:
        return self._request("GET", "/api/sessions", access_token=access_token)

    def get_session(self, session_id: str, access_token: str) -> BackendResponse:
        return self._request("GET", f"/api/sessions/{session_id}", access_token=access_token)

    def start_turn(
        self, session_id: str, turn_id: str, message: str, access_token: str,
    ) -> BackendResponse:
        return self._request(
            "POST", f"/api/sessions/{session_id}/turns",
            json_body={"turnId": turn_id, "message": message}, access_token=access_token,
        )

    def finish_turn(
        self, session_id: str, turn_id: str, messages: list[dict[str, Any]],
        access_token: str, *, status: str = "completed", error: str | None = None,
    ) -> BackendResponse:
        body: dict[str, Any] = {"status": status, "messages": messages}
        if error is not None:
            body["error"] = error
        return self._request(
            "POST", f"/api/sessions/{session_id}/turns/{turn_id}/finish",
            json_body=body, access_token=access_token,
        )

    def delete_session(self, session_id: str, access_token: str) -> BackendResponse:
        return self._request("DELETE", f"/api/sessions/{session_id}", access_token=access_token)

    def search_airports(self, query: str, limit: int, match: str) -> BackendResponse:
        return self._request(
            "GET", "/api/airports/search", query={"q": query, "limit": limit, "match": match}
        )

    def search_flights(
        self, criteria: dict[str, Any], *, departure_date_from: str, departure_date_to: str,
    ) -> BackendResponse:
        return self._request("GET", "/api/flights/search", query={
            **criteria, "departureDateFrom": departure_date_from, "departureDateTo": departure_date_to,
        })

    def get_flight(self, flight_id: str) -> BackendResponse:
        return self._request(
            "GET", f"/api/flights/{flight_id}"
        )

    def create_booking(
        self,
        flight_id: str,
        seat_count: int,
        idempotency_key: str,
        access_token: str,
    ) -> BackendResponse:
        return self._request(
            "POST",
            "/api/bookings",
            json_body={
                "flightId": flight_id,
                "seatCount": seat_count,
                "source": "AI",
                "idempotencyKey": idempotency_key,
            },
            access_token=access_token,
        )

    def list_my_bookings(
        self, page: int, limit: int, access_token: str
    ) -> BackendResponse:
        return self._request(
            "GET",
            "/api/bookings/me",
            query={"page": page, "limit": limit},
            access_token=access_token,
        )

    def cancel_booking(
        self, booking_id: str, access_token: str
    ) -> BackendResponse:
        return self._request(
            "PATCH",
            f"/api/bookings/{booking_id}/cancel",
            json_body={},
            access_token=access_token,
        )


class ToolExecutor:
    """Validate strict JSON tool arguments and dispatch safe backend calls."""

    def __init__(self, backend: BackendClient) -> None:
        self.backend = backend
        self._handlers: dict[
            str, Callable[[dict[str, Any], RequestContext], dict[str, Any]]
        ] = {
            "search_airports": self._search_airports,
            "search_flights": self._search_flights,
            "get_flight": self._get_flight,
            "create_booking": self._create_booking,
            "list_my_bookings": self._list_my_bookings,
            "cancel_booking": self._cancel_booking,
        }

    def execute(
        self, name: str, raw_arguments: str, context: RequestContext
    ) -> dict[str, Any]:
        """Execute one tool call and always return a JSON-serializable result."""

        handler = self._handlers.get(name)
        if handler is None:
            return self._error(400, "UNKNOWN_TOOL", f"Unknown tool: {name}")

        try:
            arguments = json.loads(raw_arguments)
            if not isinstance(arguments, dict):
                raise ToolInputError("Tool arguments must be a JSON object")
            return handler(arguments, context)
        except (json.JSONDecodeError, ToolInputError) as error:
            message = str(error)
            if message.startswith("AUTH_REQUIRED:"):
                return self._error(401, "AUTH_REQUIRED", message.split(":", 1)[1].strip())
            return self._error(400, "INVALID_TOOL_ARGUMENTS", message)
        except BackendConnectionError as error:
            return self._error(503, "BACKEND_UNAVAILABLE", str(error))
        except Exception:
            LOGGER.exception("Unexpected failure while executing tool %s", name)
            return self._error(
                500,
                "MIDDLE_LAYER_ERROR",
                "The middle layer could not complete this tool call",
            )

    @staticmethod
    def _error(status: int, code: str, message: str) -> dict[str, Any]:
        return {
            "ok": False,
            "status": status,
            "error": {"code": code, "message": message},
        }

    @staticmethod
    def _from_backend(response: BackendResponse) -> dict[str, Any]:
        if isinstance(response.body, dict):
            result = dict(response.body)
        else:
            result = {"body": response.body}
        result["ok"] = 200 <= response.status_code < 300
        result["status"] = response.status_code
        return result

    @staticmethod
    def _expect_exact(arguments: dict[str, Any], names: set[str]) -> None:
        actual = set(arguments)
        if actual != names:
            missing = sorted(names - actual)
            extra = sorted(actual - names)
            parts = []
            if missing:
                parts.append(f"missing fields: {', '.join(missing)}")
            if extra:
                parts.append(f"unexpected fields: {', '.join(extra)}")
            raise ToolInputError("; ".join(parts))

    @staticmethod
    def _string(value: Any, name: str) -> str:
        if not isinstance(value, str):
            raise ToolInputError(f"{name} must be a string")
        return value.strip()

    @staticmethod
    def _integer(value: Any, name: str, minimum: int, maximum: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ToolInputError(f"{name} must be an integer")
        if value < minimum or value > maximum:
            raise ToolInputError(
                f"{name} must be between {minimum} and {maximum}"
            )
        return value

    @staticmethod
    def _object_id(value: Any, name: str) -> str:
        identifier = ToolExecutor._string(value, name)
        if not OBJECT_ID_PATTERN.fullmatch(identifier):
            raise ToolInputError(f"{name} must be a 24-character ObjectId")
        return identifier.lower()

    @staticmethod
    def _require_auth(context: RequestContext) -> str:
        if not context.access_token:
            raise ToolInputError("AUTH_REQUIRED: the user must log in first")
        return context.access_token

    def _search_airports(
        self, arguments: dict[str, Any], _context: RequestContext
    ) -> dict[str, Any]:
        self._expect_exact(arguments, {"query", "match"})
        query = self._string(arguments["query"], "query")
        if not 1 <= len(query) <= 80:
            raise ToolInputError("query must contain 1 to 80 characters")
        match = self._string(arguments["match"], "match")
        if match not in {"fuzzy", "exact"}:
            raise ToolInputError("match must be fuzzy or exact")
        limit = 5
        return self._from_backend(self.backend.search_airports(query, limit, match))

    def _search_flights(
        self, arguments: dict[str, Any], _context: RequestContext
    ) -> dict[str, Any]:
        expected = {
            "origin",
            "destination",
            "departure_date_from",
            "departure_date_to",
            "departure_period",
            "airline_code",
            "passengers",
            "page",
            "sort_by",
            "sort_order",
        }
        self._expect_exact(arguments, expected)

        origin = self._string(arguments["origin"], "origin").upper()
        destination = self._string(
            arguments["destination"], "destination"
        ).upper()
        if not IATA_PATTERN.fullmatch(origin):
            raise ToolInputError("origin must be a three-letter IATA code")
        if not IATA_PATTERN.fullmatch(destination):
            raise ToolInputError("destination must be a three-letter IATA code")
        if origin == destination:
            raise ToolInputError("origin and destination must be different")

        dates = []
        for field in ("departure_date_from", "departure_date_to"):
            value = self._string(arguments[field], field)
            if not DATE_PATTERN.fullmatch(value):
                raise ToolInputError(f"{field} must use YYYY-MM-DD format")
            try:
                dates.append(date.fromisoformat(value))
            except ValueError as error:
                raise ToolInputError(f"{field} must be a valid date") from error
        if not 0 <= (dates[1] - dates[0]).days <= 30:
            raise ToolInputError("The departure date range must contain 1 to 31 calendar days")

        departure_period = self._string(
            arguments["departure_period"], "departure_period"
        ).upper()
        if departure_period not in {"ANY", "MORNING", "AFTERNOON"}:
            raise ToolInputError(
                "departure_period must be ANY, MORNING, or AFTERNOON"
            )

        airline_code = self._string(
            arguments["airline_code"], "airline_code"
        ).upper()
        if airline_code and not AIRLINE_PATTERN.fullmatch(airline_code):
            raise ToolInputError("airline_code must contain 2 or 3 letters/digits")

        passengers = self._integer(arguments["passengers"], "passengers", 1, 9)
        page = self._integer(arguments["page"], "page", 1, 10000)
        sort_by = self._string(arguments["sort_by"], "sort_by")
        if sort_by not in {
            "departureAt",
            "arrivalAt",
            "availableSeats",
            "price",
        }:
            raise ToolInputError("sort_by is not supported")
        sort_order = self._string(arguments["sort_order"], "sort_order").lower()
        if sort_order not in {"asc", "desc"}:
            raise ToolInputError("sort_order must be asc or desc")

        criteria: dict[str, Any] = {
            "origin": origin,
            "destination": destination,
            "passengers": passengers,
            "page": page,
            "limit": 5,
            "sortBy": sort_by,
            "sortOrder": sort_order,
        }
        if departure_period != "ANY":
            criteria["departurePeriod"] = departure_period
        if airline_code:
            criteria["airlineCode"] = airline_code

        return self._from_backend(self.backend.search_flights(
            criteria, departure_date_from=dates[0].isoformat(), departure_date_to=dates[1].isoformat(),
        ))

    def _get_flight(
        self, arguments: dict[str, Any], _context: RequestContext
    ) -> dict[str, Any]:
        self._expect_exact(arguments, {"flight_id"})
        flight_id = self._object_id(arguments["flight_id"], "flight_id")
        return self._from_backend(self.backend.get_flight(flight_id))

    def _create_booking(
        self, arguments: dict[str, Any], context: RequestContext
    ) -> dict[str, Any]:
        self._expect_exact(arguments, {"flight_id", "seat_count"})
        flight_id = self._object_id(arguments["flight_id"], "flight_id")
        seat_count = self._integer(arguments["seat_count"], "seat_count", 1, 9)
        access_token = self._require_auth(context)

        try:
            canonical_request_id = str(uuid.UUID(context.request_id))
        except ValueError as error:
            raise ToolInputError("request_id must be a canonical UUID") from error
        response = self.backend.create_booking(
            flight_id, seat_count, canonical_request_id, access_token
        )
        return self._from_backend(response)

    def _list_my_bookings(
        self, arguments: dict[str, Any], context: RequestContext
    ) -> dict[str, Any]:
        self._expect_exact(arguments, {"page"})
        page = self._integer(arguments["page"], "page", 1, 10000)
        access_token = self._require_auth(context)
        return self._from_backend(
            self.backend.list_my_bookings(page, 10, access_token)
        )

    def _cancel_booking(
        self, arguments: dict[str, Any], context: RequestContext
    ) -> dict[str, Any]:
        self._expect_exact(arguments, {"booking_id"})
        booking_id = self._object_id(arguments["booking_id"], "booking_id")
        access_token = self._require_auth(context)
        return self._from_backend(
            self.backend.cancel_booking(booking_id, access_token)
        )


def serialize_messages(messages: list[Any]) -> list[dict[str, Any]]:
    """Preserve complete SDK messages, including reasoning and tool-call arguments."""
    return [
        message if isinstance(message, dict) else message.model_dump(mode="json")
        for message in messages
    ]


class FlightBookingAssistant:
    """Run a complete DeepSeek → tool → DeepSeek conversation turn."""

    def __init__(
        self,
        *,
        deepseek_client: Any,
        tool_executor: ToolExecutor,
        model: str = DEFAULT_MODEL,
        timezone: str = "Asia/Singapore",
        max_tool_rounds: int = 8,
    ) -> None:
        if not model.strip():
            raise ConfigurationError("DEEPSEEK_MODEL cannot be empty")
        if max_tool_rounds < 1 or max_tool_rounds > 20:
            raise ConfigurationError("DEEPSEEK_MAX_TOOL_ROUNDS must be 1 to 20")
        self.deepseek_client = deepseek_client
        self.tool_executor = tool_executor
        self.model = model
        self.timezone = timezone
        self._zone = _load_timezone(timezone)
        self.max_tool_rounds = max_tool_rounds

    def new_history(self, now: datetime | None = None) -> list[Any]:
        """Create a conversation with a date-aware system instruction."""

        if now is None:
            local_now = datetime.now(self._zone)
        elif now.tzinfo is None:
            local_now = now.replace(tzinfo=self._zone)
        else:
            local_now = now.astimezone(self._zone)
        prompt = SYSTEM_PROMPT_TEMPLATE.format(
            today=local_now.date().isoformat(), timezone=self.timezone
        )
        return [{"role": "system", "content": prompt}]

    def respond(
        self,
        history: list[Any],
        user_message: str,
        *,
        access_token: str | None,
        request_id: str,
    ) -> str:
        """Append a complete conversation turn to history and return the final text."""

        content = user_message.strip()
        if not content:
            raise ValueError("user_message cannot be empty")

        history.append({"role": "user", "content": content})
        context = RequestContext(
            access_token=access_token,
            request_id=request_id,
        )
        booking_attempted = False

        for _round in range(self.max_tool_rounds):
            response = self.deepseek_client.chat.completions.create(
                model=self.model,
                messages=history,
                tools=TOOLS,
            )
            if not response.choices:
                raise AssistantResponseError("DeepSeek returned no completion choice")

            message = response.choices[0].message
            # Keeping the SDK object preserves reasoning_content when a selected
            # DeepSeek thinking model requires it on subsequent tool-call rounds.
            history.append(message)
            if hasattr(message, "tool_calls"):
                tool_calls = message.tool_calls
            else:
                tool_calls = []
            if not tool_calls:
                final_content = message.content
                if not isinstance(final_content, str) or not final_content.strip():
                    raise AssistantResponseError(
                        "DeepSeek returned neither a tool call nor response text"
                    )
                return final_content.strip()

            for tool_call in tool_calls:
                function = tool_call.function
                if function.name == "create_booking" and booking_attempted:
                    result = ToolExecutor._error(
                        409,
                        "BOOKING_TURN_LIMIT",
                        "create_booking was already attempted this turn; do not call it again.",
                    )
                else:
                    if function.name == "create_booking":
                        booking_attempted = True
                    result = self.tool_executor.execute(
                        function.name, function.arguments, context
                    )
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(
                            result, ensure_ascii=False, separators=(",", ":")
                        ),
                    }
                )

        raise ToolLoopLimitError(
            "DeepSeek exceeded the maximum number of tool-calling rounds"
        )


def build_assistant_from_env() -> FlightBookingAssistant:
    """Construct the production assistant from environment variables."""

    try:
        from dotenv import load_dotenv
    except ImportError:
        pass
    else:
        load_dotenv(Path(__file__).with_name(".env"))

    if OpenAI is None:
        raise ConfigurationError(
            "The openai package is not installed; run pip install -r requirements.txt"
        )

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise ConfigurationError("DEEPSEEK_API_KEY is required")

    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/beta")
    model = os.getenv("DEEPSEEK_MODEL", DEFAULT_MODEL)
    backend_url = os.getenv("BACKEND_BASE_URL", "http://localhost:3000")
    timezone = os.getenv("MIDDLE_TIMEZONE", "Asia/Singapore")

    try:
        backend_timeout = float(os.getenv("BACKEND_TIMEOUT_SECONDS", "10"))
        max_tool_rounds = int(os.getenv("DEEPSEEK_MAX_TOOL_ROUNDS", "8"))
    except ValueError as error:
        raise ConfigurationError(
            "Timeout and tool-round settings must be numeric"
        ) from error

    deepseek_client = OpenAI(api_key=api_key, base_url=base_url)
    backend = BackendClient(backend_url, timeout_seconds=backend_timeout)
    return FlightBookingAssistant(
        deepseek_client=deepseek_client,
        tool_executor=ToolExecutor(backend),
        model=model,
        timezone=timezone,
        max_tool_rounds=max_tool_rounds,
    )


def _interactive_main() -> None:
    """Minimal terminal client useful for testing without the frontend."""

    logging.basicConfig(level=logging.INFO)
    assistant = build_assistant_from_env()
    history = assistant.new_history()
    access_token = os.getenv("BACKEND_ACCESS_TOKEN")
    print("Flight assistant ready. Type exit to quit.")
    while True:
        user_message = input("User> ").strip()
        if user_message.lower() in {"exit", "quit"}:
            return
        reply = assistant.respond(
            history,
            user_message,
            access_token=access_token,
            request_id=str(uuid.uuid4()),
        )
        print(f"Assistant> {reply}")


if __name__ == "__main__":
    _interactive_main()
