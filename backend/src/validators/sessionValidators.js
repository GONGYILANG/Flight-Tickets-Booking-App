import { invalidRequest } from "../errors.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const modelRoles = new Set(["system", "user", "assistant", "tool"]);

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

function parsePaginationInteger(value, field, defaultValue, maximum, fields) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fields.push({ field, message: `${field} must be an integer from 1 to ${maximum}` });
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > maximum) {
    fields.push({ field, message: `${field} must be an integer from 1 to ${maximum}` });
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

export function validateListSessions(request, _response, next) {
  const fields = [];
  const page = parsePaginationInteger(request.query.page, "page", 1, 10000, fields);
  const limit = parsePaginationInteger(request.query.limit, "limit", 20, 50, fields);
  if (fields.length > 0) {
    throw invalidRequest(fields, "One or more request parameters are invalid");
  }
  request.validatedQuery = { page, limit };
  next();
}

export function validateSessionId(request, _response, next) {
  const fields = [];
  request.params.sessionId = parseUuid(
    request.params.sessionId,
    "sessionId",
    fields,
  );
  if (fields.length > 0) {
    return next(invalidRequest(fields));
  }
  return next();
}

export function validateAppendSessionMessages(request, _response, next) {
  const body = requestBody(request);
  const fields = [];
  rejectUnknownFields(body, new Set(["messages"]), fields);
  const messages = body.messages;
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 100 ||
    messages.some(
      (message) => !isObject(message) || !modelRoles.has(message.role),
    )
  ) {
    fields.push({
      field: "messages",
      message: "messages must contain 1 to 100 valid model message objects",
    });
  }
  if (fields.length > 0) {
    throw invalidRequest(fields);
  }
  request.validatedBody = { messages };
  next();
}
