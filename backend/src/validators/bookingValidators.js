import mongoose from "mongoose";
import { invalidRequest } from "../errors.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requestBody(request) {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    throw invalidRequest([
      { field: "body", message: "A JSON object is required" },
    ]);
  }
  return request.body;
}

function parseFlightId(value, fields) {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value)) {
    fields.push({
      field: "flightId",
      message: "flightId must be a valid ObjectId",
    });
  }
  return value;
}

function parseSeatCount(value, fields) {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    fields.push({
      field: "seatCount",
      message: "seatCount must be an integer from 1 to 9",
    });
  }
  return value;
}

function parseSource(value, fields) {
  if (value === undefined) {
    return "UI";
  }
  const source = typeof value === "string" ? value.trim().toUpperCase() : value;
  if (!["UI", "AI"].includes(source)) {
    fields.push({ field: "source", message: "source must be UI or AI" });
  }
  return source;
}

function parseIdempotencyKey(value, fields) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!uuidPattern.test(key)) {
    fields.push({
      field: "idempotencyKey",
      message: "idempotencyKey must be a canonical UUID",
    });
  }
  return key;
}

function parsePaginationInteger(
  value,
  field,
  defaultValue,
  maximum,
  fields,
) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fields.push({
      field,
      message: `${field} must be an integer from 1 to ${maximum}`,
    });
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > maximum) {
    fields.push({
      field,
      message: `${field} must be an integer from 1 to ${maximum}`,
    });
  }
  return parsed;
}

export function validateCreateBooking(request, _response, next) {
  const body = requestBody(request);
  const fields = [];
  const flightId = parseFlightId(body.flightId, fields);
  const seatCount = parseSeatCount(body.seatCount, fields);
  const source = parseSource(body.source, fields);
  const idempotencyKey = parseIdempotencyKey(
    body.idempotencyKey,
    fields,
  );

  if (fields.length > 0) {
    throw invalidRequest(fields);
  }

  request.validatedBody = {
    flightId,
    seatCount,
    source,
    idempotencyKey,
  };
  next();
}

export function validateListBookings(request, _response, next) {
  const fields = [];
  const page = parsePaginationInteger(
    request.query.page,
    "page",
    1,
    10000,
    fields,
  );
  const limit = parsePaginationInteger(
    request.query.limit,
    "limit",
    20,
    50,
    fields,
  );

  if (fields.length > 0) {
    throw invalidRequest(fields);
  }

  request.validatedQuery = { page, limit };
  next();
}

export function validateBookingId(request, _response, next) {
  if (!mongoose.isObjectIdOrHexString(request.params.bookingId)) {
    return next(
      invalidRequest([
        {
          field: "bookingId",
          message: "bookingId must be a valid ObjectId",
        },
      ]),
    );
  }
  return next();
}
