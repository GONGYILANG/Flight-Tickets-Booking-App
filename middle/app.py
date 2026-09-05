"""FastAPI entry point used by the frontend AI chat window."""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

try:
    from .resolution import (
        AssistantResponseError,
        BackendClient,
        BackendConnectionError,
        ConfigurationError,
        FlightBookingAssistant,
        ToolLoopLimitError,
        build_assistant_from_env,
    )
except ImportError:  # Supports ``uvicorn app:app`` from the middle directory.
    from resolution import (  # type: ignore[no-redef]
        AssistantResponseError,
        BackendClient,
        BackendConnectionError,
        ConfigurationError,
        FlightBookingAssistant,
        ToolLoopLimitError,
        build_assistant_from_env,
    )


load_dotenv(Path(__file__).with_name(".env"))
LOGGER = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    """One natural-language message and optional client idempotency fields."""

    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1, max_length=4000)
    session_id: uuid.UUID | None = Field(default=None, alias="sessionId")
    request_id: uuid.UUID | None = Field(default=None, alias="requestId")


class ChatResponse(BaseModel):
    """Assistant reply plus IDs the frontend must reuse on later requests."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: uuid.UUID = Field(alias="sessionId")
    request_id: uuid.UUID = Field(alias="requestId")
    message: str
    replayed: bool = False
    # public REST DTOs pass through unchanged; add per-tool models if their contracts diverge.
    events: list[dict[str, Any]] = Field(default_factory=list)


@dataclass
class CachedReply:
    user_message: str
    assistant_message: str
    events: list[dict[str, Any]]


@dataclass
class SessionState:
    history: list[Any]
    last_access: float
    lock: threading.Lock = field(default_factory=threading.Lock)
    replies: OrderedDict[str, CachedReply] = field(default_factory=OrderedDict)


class SessionStore:
    """Bounded in-memory conversation store for a single Uvicorn worker."""

    def __init__(
        self,
        *,
        max_sessions: int = 1000,
        ttl_seconds: int = 3600,
        max_cached_replies: int = 50,
    ) -> None:
        if max_sessions < 1 or ttl_seconds < 1 or max_cached_replies < 1:
            raise ConfigurationError("Session limits must be positive integers")
        self.max_sessions = max_sessions
        self.ttl_seconds = ttl_seconds
        self.max_cached_replies = max_cached_replies
        self._sessions: dict[tuple[str, str], SessionState] = {}
        self._lock = threading.Lock()

    def get_or_create(
        self, session_id: uuid.UUID, assistant: FlightBookingAssistant, user_id: str
    ) -> SessionState:
        now = time.monotonic()
        key = (user_id, str(session_id))
        with self._lock:
            expired = [
                candidate
                for candidate, state in self._sessions.items()
                if now - state.last_access > self.ttl_seconds
            ]
            for candidate in expired:
                del self._sessions[candidate]

            state = self._sessions.get(key)
            if state is None:
                if len(self._sessions) >= self.max_sessions:
                    oldest = min(
                        self._sessions,
                        key=lambda candidate: self._sessions[candidate].last_access,
                    )
                    del self._sessions[oldest]
                state = SessionState(
                    history=assistant.new_history(), last_access=now
                )
                self._sessions[key] = state
            state.last_access = now
            return state

    def delete(self, session_id: uuid.UUID, user_id: str) -> bool:
        with self._lock:
            return self._sessions.pop((user_id, str(session_id)), None) is not None

    def cache_reply(
        self,
        state: SessionState,
        request_id: str,
        user_message: str,
        assistant_message: str,
        events: list[dict[str, Any]],
    ) -> None:
        state.replies[request_id] = CachedReply(
            user_message, assistant_message, list(events)
        )
        state.replies.move_to_end(request_id)
        while len(state.replies) > self.max_cached_replies:
            state.replies.popitem(last=False)


def _positive_integer_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ConfigurationError(f"{name} must be an integer") from error
    if value < 1:
        raise ConfigurationError(f"{name} must be positive")
    return value


SESSION_STORE = SessionStore(
    max_sessions=_positive_integer_env("MAX_CHAT_SESSIONS", 1000),
    ttl_seconds=_positive_integer_env("CHAT_SESSION_TTL_SECONDS", 3600),
    max_cached_replies=_positive_integer_env("MAX_CACHED_REPLIES", 50),
)
_assistant: FlightBookingAssistant | None = None
_assistant_lock = threading.Lock()


def get_assistant() -> FlightBookingAssistant:
    """Initialize the external SDK only when the first chat request arrives."""

    global _assistant
    if _assistant is None:
        with _assistant_lock:
            if _assistant is None:
                _assistant = build_assistant_from_env()
    return _assistant

bearer_scheme = HTTPBearer(
    bearerFormat="JWT",
    auto_error=False,
    description="JWT returned by the Node.js /api/auth/login endpoint",
)


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> str:
    """Validate on every request, including cached replies and session deletion."""
    if credentials is None:
        raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "message": "Sign in to use the assistant"})
    try:
        backend = BackendClient(
            os.getenv("BACKEND_BASE_URL", "http://localhost:3000"),
            timeout_seconds=float(os.getenv("BACKEND_TIMEOUT_SECONDS", "10")),
        )
        response = backend.get_me(credentials.credentials)
    except (ValueError, ConfigurationError, BackendConnectionError) as error:
        raise HTTPException(503, detail={"code": "BACKEND_UNAVAILABLE", "message": "The booking service is unavailable"}) from error
    if response.status_code != 200:
        raise HTTPException(response.status_code, detail=response.body.get("error", {}))
    return response.body["data"]["user"]["id"]

app = FastAPI(
    title="Flight Booking AI Middle Layer",
    version="0.1.0",
    description="Natural-language chat orchestration for the FlightBooking REST API.",
)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    """Report middle-layer health and the current backend connection state."""

    backend_url = os.getenv("BACKEND_BASE_URL", "http://localhost:3000")
    try:
        timeout = float(os.getenv("BACKEND_TIMEOUT_SECONDS", "10"))
        response = BackendClient(backend_url, timeout_seconds=timeout).health()
        backend = {
            "reachable": True,
            "status": response.status_code,
            "body": response.body,
        }
    except (ValueError, ConfigurationError, BackendConnectionError) as error:
        backend = {"reachable": False, "message": str(error)}
    return {"status": "ok", "backend": backend}


@app.post("/api/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    user_id: str = Depends(current_user_id),
    credentials: HTTPAuthorizationCredentials | None = Security(
        bearer_scheme
    ),
) -> ChatResponse:
    """Process one conversational turn and any model-selected backend tools."""

    session_id = request.session_id or uuid.uuid4()
    request_id = request.request_id or uuid.uuid4()
    user_message = request.message.strip()
    if not user_message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "EMPTY_MESSAGE", "message": "message cannot be blank"},
        )

    try:
        assistant = get_assistant()
        state = SESSION_STORE.get_or_create(session_id, assistant, user_id)
    except ConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "MIDDLE_LAYER_NOT_CONFIGURED", "message": str(error)},
        ) from error

    request_key = str(request_id)
    with state.lock:
        cached = state.replies.get(request_key)
        if cached is not None:
            if cached.user_message != user_message:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "REQUEST_ID_CONFLICT",
                        "message": "requestId was already used for another message",
                    },
                )
            return ChatResponse(
                sessionId=session_id,
                requestId=request_id,
                message=cached.assistant_message,
                replayed=True,
                events=cached.events,
            )

        original_history_length = len(state.history)
        events: list[dict[str, Any]] = []
        try:
            assistant_message = assistant.respond(
                state.history,
                user_message,
                access_token=(
                    credentials.credentials
                    if credentials is not None
                    else None
                ),
                request_id=request_key,
                event_sink=events,
            )
        except (AssistantResponseError, ToolLoopLimitError) as error:
            del state.history[original_history_length:]
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "AI_RESPONSE_ERROR", "message": str(error)},
            ) from error
        except HTTPException:
            del state.history[original_history_length:]
            raise
        except Exception as error:
            del state.history[original_history_length:]
            LOGGER.exception("DeepSeek request failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "AI_PROVIDER_UNAVAILABLE",
                    "message": "The AI provider could not complete the request",
                },
            ) from error

        SESSION_STORE.cache_reply(
            state,
            request_key,
            user_message,
            assistant_message,
            events,
        )
        return ChatResponse(
            sessionId=session_id,
            requestId=request_id,
            message=assistant_message,
            events=events,
        )


@app.delete("/api/chat/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: uuid.UUID, user_id: str = Depends(current_user_id)) -> Response:
    """Forget one in-memory conversation; deleting a missing session is harmless."""

    SESSION_STORE.delete(session_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
