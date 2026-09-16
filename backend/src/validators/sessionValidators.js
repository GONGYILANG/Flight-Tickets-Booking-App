import { invalidRequest } from "../errors.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requestBody(request) {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw invalidRequest([{ field: "body", message: "A JSON object is required" }]);
  }
  return request.body;
}

function rejectUnknownFields(body, allowed, fields) {
  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) {
      fields.push({ field, message: `${field} is not allowed` });
    }
  }
}

function parseUuid(value, field, fields) {
  const parsed = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!uuidPattern.test(parsed)) {
    fields.push({ field, message: `${field} must be a canonical UUID` });
  }
  return parsed;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateCreateSession(request, _response, next) {
  const body = requestBody(request);
  const fields = [];
  rejectUnknownFields(body, new Set(["sessionId"]), fields);
  const sessionId = parseUuid(body.sessionId, "sessionId", fields);
  if (fields.length > 0) {
    throw invalidRequest(fields);
  }
  request.validatedBody = { sessionId };
  next();
}

export function validateSessionId(request, _response, next) {
  const fields = [];
  request.params.sessionId = parseUuid(request.params.sessionId, "sessionId", fields);
  if (fields.length > 0) {
    return next(invalidRequest(fields));
  }
  return next();
}

export function validateStartTurn(request, _response, next) {
  const body = requestBody(request);
  const fields = [];
  rejectUnknownFields(body, new Set(["turnId", "message"]), fields);
  const turnId = parseUuid(body.turnId, "turnId", fields);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 4000) {
    fields.push({ field: "message", message: "message must contain 1 to 4000 characters" });
  }
  if (fields.length) throw invalidRequest(fields);
  request.validatedBody = { turnId, message };
  next();
}

// Validate at the persistence boundary; keep SDK/provider extras in messages intact.
function turnView(messages, status) {
  function invalid(message) {
    throw invalidRequest([{ field: "messages", message }]);
  }
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 100) {
    invalid("messages must contain 1 to 100 model messages");
  }
  const first = messages[0];
  if (
    !isObject(first) ||
    first.role !== "user" ||
    typeof first.content !== "string" ||
    !first.content.trim() ||
    first.content.length > 4000
  ) {
    invalid("The first message must contain the original user input");
  }
  const pending = new Map();
  const seen = new Set();
  const events = [];
  for (const message of messages.slice(1)) {
    if (!isObject(message)) invalid("Each message must be a JSON object");
    if (message.role === "assistant") {
      if (pending.size) invalid("Tool results must precede the next assistant message");
      if (message.content !== null && typeof message.content !== "string") {
        invalid("Assistant content must be a string or null");
      }
      const calls = message.tool_calls ?? [];
      if (!Array.isArray(calls)) invalid("tool_calls must be an array or null");
      for (const call of calls) {
        if (
          !isObject(call) ||
          typeof call.id !== "string" ||
          !call.id ||
          seen.has(call.id) ||
          call.type !== "function" ||
          !isObject(call.function) ||
          typeof call.function.name !== "string" ||
          !call.function.name.trim() ||
          typeof call.function.arguments !== "string"
        ) {
          invalid("Each tool call needs a unique id, function name, and argument string");
        }
        seen.add(call.id);
        pending.set(call.id, call.function.name);
      }
    } else if (message.role === "tool") {
      if (!pending.has(message.tool_call_id) || typeof message.content !== "string") {
        invalid("Each tool result must match an unanswered tool call");
      }
      let result;
      try {
        result = JSON.parse(message.content);
      } catch {
        invalid("Tool content must be a JSON-encoded result object");
      }
      if (!isObject(result)) invalid("Tool content must encode a result object");
      events.push({ tool: pending.get(message.tool_call_id), result });
      pending.delete(message.tool_call_id);
    } else {
      invalid("Only assistant and tool messages may follow the initial user message");
    }
  }
  const last = messages.at(-1);
  const finalText =
    last.role === "assistant" && !last.tool_calls?.length && typeof last.content === "string"
      ? last.content.trim()
      : null;
  if (status === "completed" && (pending.size || !finalText)) {
    invalid("A completed turn must resolve every tool call and end with assistant text");
  }
  return { userMessage: first.content, assistantMessage: finalText || null, events };
}

export function validateFinishTurn(request, _response, next) {
  const body = requestBody(request);
  const fields = [];
  request.params.turnId = parseUuid(request.params.turnId, "turnId", fields);
  rejectUnknownFields(body, new Set(["status", "messages", "error"]), fields);
  if (!["completed", "failed"].includes(body.status)) {
    fields.push({ field: "status", message: "status must be completed or failed" });
  }
  if (
    body.status === "failed" &&
    (typeof body.error !== "string" || !body.error.trim() || body.error.length > 2000)
  ) {
    fields.push({
      field: "error",
      message: "A failed turn needs an error of 1 to 2000 characters",
    });
  }
  if (body.status === "completed" && body.error != null) {
    fields.push({ field: "error", message: "A completed turn cannot have an error" });
  }
  if (fields.length) throw invalidRequest(fields);
  request.validatedBody = {
    status: body.status,
    messages: body.messages,
    view: turnView(body.messages, body.status),
    error: body.status === "failed" ? body.error.trim() : null,
  };
  next();
}
