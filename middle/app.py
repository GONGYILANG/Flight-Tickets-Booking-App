"""FastAPI chat orchestration backed by the Node.js Session and Turn APIs."""

from __future__ import annotations

import logging
import os
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from weakref import WeakValueDictionary

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response, Security
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

try:
    from .resolution import (
        AssistantResponseError, BackendConnectionError, ConfigurationError,
        ToolLoopLimitError, BackendResponse, BackendClient,
        serialize_messages, FlightBookingAssistant, build_assistant_from_env
    )
except ImportError:  # Supports "uvicorn app:app" from the middle directory.
    from resolution import (
        AssistantResponseError, BackendConnectionError, ConfigurationError,
        ToolLoopLimitError, BackendResponse, BackendClient,
        serialize_messages, FlightBookingAssistant, build_assistant_from_env
    )

load_dotenv(Path(__file__).with_name(".env"))
LOGGER = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1, max_length=4000)
    session_id: uuid.UUID | None = Field(default=None, alias="sessionId")
    request_id: uuid.UUID | None = Field(default=None, alias="requestId")


class ChatResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    session_id: uuid.UUID = Field(alias="sessionId")
    request_id: uuid.UUID = Field(alias="requestId")
    message: str
    replayed: bool = False
    events: list[dict[str, Any]] = Field(default_factory=list)


_assistant: FlightBookingAssistant | None = None
_assistant_lock = threading.Lock()
# locks are process-local; use one worker/replica until backend execution leases exist.
_session_locks: WeakValueDictionary = WeakValueDictionary()
_session_locks_guard = threading.Lock()


@contextmanager
def session_lock(user_id: str, session_id: str):
    """Keep only execution locks in memory; release entries after the last waiter."""
    with _session_locks_guard:
        lock = _session_locks.setdefault((user_id, session_id), threading.Lock())
    with lock:
        yield


def get_assistant() -> FlightBookingAssistant:
    global _assistant
    if _assistant is None:
        with _assistant_lock:
            if _assistant is None:
                _assistant = build_assistant_from_env()
    return _assistant


def get_backend() -> BackendClient:
    try:
        return BackendClient(
            os.getenv("BACKEND_BASE_URL", "http://localhost:3000"),
            timeout_seconds=float(os.getenv("BACKEND_TIMEOUT_SECONDS", "10")),
        )
    except (ValueError, ConfigurationError) as error:
        raise HTTPException(503, detail={
            "code": "BACKEND_UNAVAILABLE", "message": "The booking service is unavailable",
        }) from error


def backend_result(response: BackendResponse) -> dict[str, Any]:
    if not 200 <= response.status_code < 300:
        raise HTTPException(response.status_code, detail=response.body.get("error", {}))
    return response.body


bearer_scheme = HTTPBearer(
    bearerFormat="JWT", auto_error=False,
    description="JWT returned by the Node.js /api/auth/login endpoint",
)


def require_token(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(401, detail={
            "code": "AUTH_REQUIRED", "message": "Sign in to use the assistant",
        })
    return credentials.credentials


def current_user_id(
    token: str = Depends(require_token), backend: BackendClient = Depends(get_backend),
) -> str:
    """Revalidate before processing, replaying, restoring, or deleting a conversation."""
    return backend_result(backend.get_me(token))["data"]["user"]["id"]


app = FastAPI(
    title="Flight Booking AI Middle Layer", version="0.1.0",
    description="Natural-language chat orchestration for the FlightBooking REST API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGINS", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(BackendConnectionError)
async def backend_unavailable(_request, _error):
    return JSONResponse(status_code=503, content={"detail": {
        "code": "BACKEND_UNAVAILABLE", "message": "The booking service is unavailable",
    }})


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        response = get_backend().health()
        backend = {"reachable": True, "status": response.status_code, "body": response.body}
    except (HTTPException, BackendConnectionError):
        backend = {"reachable": False, "message": "The booking service is unavailable"}
    return {"status": "ok", "backend": backend}


def finish_saved_turn(
    backend: BackendClient, session_id: str, request_id: str,
    messages: list[dict[str, Any]], token: str, *,
    status: str = "completed", error: str | None = None,
) -> dict[str, Any]:
    # Repeat the identical write once after a lost acknowledgement; never rerun tools here.
    for _ in range(2):
        try:
            response = backend.finish_turn(
                session_id, request_id, messages, token, status=status, error=error,
            )
        except BackendConnectionError:
            continue
        if response.status_code < 500:
            return backend_result(response)["data"]["turn"]
    raise HTTPException(503, detail={
        "code": "TURN_SAVE_FAILED",
        "message": "The turn could not be confirmed as saved. Retry with the same sessionId and requestId.",
    })


def chat_reply(session_id: str, turn: dict[str, Any], *, replayed: bool) -> ChatResponse:
    return ChatResponse(
        sessionId=session_id, requestId=turn["turnId"], replayed=replayed,
        message=turn["view"]["assistantMessage"], events=turn["view"]["events"],
    )


def process_chat(
    backend: BackendClient, token: str, session_id: str, request_id: str, message: str,
) -> ChatResponse:
    backend_result(backend.create_session(session_id, token))
    session = backend_result(backend.get_session(session_id, token))["data"]["session"]
    turns = session["turns"]
    existing = next((turn for turn in turns if turn["turnId"] == request_id), None)
    if existing:
        if existing["view"]["userMessage"] != message:
            raise HTTPException(409, detail={
                "code": "TURN_ID_CONFLICT", "message": "requestId was used for a different message",
            })
        if existing["status"] == "completed":
            return chat_reply(session_id, existing, replayed=True)
        if existing["status"] == "failed" and existing != turns[-1]:
            raise HTTPException(409, detail={
                "code": "TURN_RETRY_OUT_OF_ORDER",
                "message": "Only the latest failed turn can be retried. Send a new message instead.",
            })
    pending = next((turn for turn in turns if turn["status"] == "pending"), None)
    if pending:
        raise HTTPException(409, detail={
            "code": "TURN_PENDING", "turnId": pending["turnId"],
            "message": "A turn has an unconfirmed outcome. Restore the session and reconcile it before continuing.",
        })

    try:
        assistant = get_assistant()
    except ConfigurationError as error:
        raise HTTPException(503, detail={
            "code": "MIDDLE_LAYER_NOT_CONFIGURED", "message": str(error),
        }) from error
    started = backend_result(backend.start_turn(session_id, request_id, message, token))
    turn = started["data"]["turn"]
    if turn["status"] == "completed":
        return chat_reply(session_id, turn, replayed=True)
    if started["meta"]["alreadyExists"] and turn["status"] == "pending":
        raise HTTPException(409, detail={
            "code": "TURN_PENDING", "message": "This turn already has an unconfirmed execution.",
        })

    history = assistant.new_history()
    for previous in turns:
        if previous["sequence"] < turn["sequence"] and previous["status"] == "completed":
            history.extend(previous["messages"])
    if any(previous["status"] == "failed" for previous in turns):
        history.append({
            "role": "system",
            "content": "An earlier attempt did not complete. Tool side effects may still exist. "
                       "Verify current bookings before further booking changes; do not assume failure undid them.",
        })
    original_length = len(history)
    try:
        assistant.respond(history, message, access_token=token, request_id=request_id)
    except Exception as error:
        if isinstance(error, (AssistantResponseError, ToolLoopLimitError)):
            code, explanation = "AI_RESPONSE_ERROR", str(error)
        else:
            LOGGER.exception("DeepSeek request failed")
            code, explanation = "AI_PROVIDER_UNAVAILABLE", "The AI provider could not complete the request"
        messages = serialize_messages(history[original_length:]) or [{"role": "user", "content": message}]
        finish_saved_turn(
            backend, session_id, request_id, messages, token,
            status="failed", error=explanation[:2000],
        )
        raise HTTPException(502, detail={"code": code, "message": explanation}) from error

    # Saving errors must not overwrite a possibly committed completion with a failed snapshot.
    saved = finish_saved_turn(
        backend, session_id, request_id, serialize_messages(history[original_length:]), token,
    )
    return chat_reply(session_id, saved, replayed=False)


@app.post("/api/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest, user_id: str = Depends(current_user_id),
    token: str = Depends(require_token), backend: BackendClient = Depends(get_backend),
) -> ChatResponse:
    session_id = str(request.session_id or uuid.uuid4())
    request_id = str(request.request_id or uuid.uuid4())
    message = request.message.strip()
    if not message:
        raise HTTPException(422, detail={"code": "EMPTY_MESSAGE", "message": "message cannot be blank"})
    try:
        with session_lock(user_id, session_id):
            return process_chat(backend, token, session_id, request_id, message)
    except BackendConnectionError as error:
        raise HTTPException(503, detail={
            "code": "BACKEND_UNAVAILABLE", "message": "The booking service is unavailable",
            "sessionId": session_id, "requestId": request_id,
        }) from error
    except HTTPException as error:
        error.detail = {**error.detail, "sessionId": session_id, "requestId": request_id}
        raise


@app.get("/api/chat/sessions")
def list_sessions(
    _user_id: str = Depends(current_user_id), token: str = Depends(require_token),
    backend: BackendClient = Depends(get_backend),
) -> dict[str, Any]:
    return backend_result(backend.list_sessions(token))


@app.get("/api/chat/sessions/{session_id}")
def get_session(
    session_id: uuid.UUID, _user_id: str = Depends(current_user_id),
    token: str = Depends(require_token), backend: BackendClient = Depends(get_backend),
) -> dict[str, Any]:
    session = backend_result(backend.get_session(str(session_id), token))["data"]["session"]
    # UI restoration exposes saved views, never model reasoning or raw tool arguments.
    fields = ("turnId", "sequence", "status", "view", "error", "createdAt", "updatedAt")
    return {"data": {"session": {
        **session, "turns": [{key: turn[key] for key in fields} for turn in session["turns"]],
    }}}


@app.delete("/api/chat/{session_id}", status_code=204)
def delete_session(
    session_id: uuid.UUID, user_id: str = Depends(current_user_id),
    token: str = Depends(require_token), backend: BackendClient = Depends(get_backend),
) -> Response:
    with session_lock(user_id, str(session_id)):
        backend_result(backend.delete_session(str(session_id), token))
    return Response(status_code=204)
