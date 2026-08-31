import mongoose from "mongoose";

const userStatuses = new Set(["ACTIVE", "LOCKED", "DISABLED"]);
const userRoles = new Set(["USER", "ADMIN"]);
const bookingStatuses = new Set(["CONFIRMED", "CANCELLED"]);
const bookingSources = new Set(["UI", "AI"]);
const flightStatuses = new Set([
  "SCHEDULED",
  "DELAYED",
  "CANCELLED",
  "DEPARTED",
  "ARRIVED",
]);
const adminFlightSortFields = new Set([
  "departureAt",
  "arrivalAt",
  "availableSeats",
  "price",
  "createdAt",
]);
const airportCodePattern = /^[A-Z]{3}$/;
const airlineCodePattern = /^[A-Z0-9]{2,3}$/;
const flightNumberPattern = /^[A-Z0-9]{2,12}$/;
const isoInstantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function invalidRequest(fields) {
  const error = new Error("One or more request fields are invalid");
  error.code = "INVALID_REQUEST";
  error.statusCode = 400;
  error.details = { fields };
  return error;
}

function adminReasonRequired(field = "reason") {
  const error = new Error(
    "An administrator reason containing 3 to 500 characters is required",
  );
  error.code = "ADMIN_REASON_REQUIRED";
  error.statusCode = 400;
  error.details = {
    fields: [
      {
        field,
        message: "reason must contain from 3 to 500 characters",
      },
    ],
  };
  return error;
}

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

function rejectUnknownFields(body, allowedFields, fields) {
  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      fields.push({ field, message: `${field} is not allowed` });
    }
  }
}

function parsePagination(value, field, defaultValue, maximum, fields) {
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

function parseEnum(value, field, allowedValues, fields, { optional = true } = {}) {
  if (value === undefined && optional) {
    return null;
  }
  if (typeof value !== "string") {
    fields.push({
      field,
      message: `${field} must be one of ${[...allowedValues].join(", ")}`,
    });
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (!allowedValues.has(normalized)) {
    fields.push({
      field,
      message: `${field} must be one of ${[...allowedValues].join(", ")}`,
    });
  }
  return normalized;
}

function parseObjectId(value, field, fields, { optional = false } = {}) {
  if (value === undefined && optional) {
    return null;
  }
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value)) {
    fields.push({ field, message: `${field} must be a valid ObjectId` });
  }
  return value;
}

function parseDate(value, field, fields) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    fields.push({ field, message: `${field} must be a valid ISO 8601 time` });
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fields.push({ field, message: `${field} must be a valid ISO 8601 time` });
    return undefined;
  }
  return parsed;
}

function parseOptionalCode(value, field, pattern, message, fields) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    fields.push({ field, message });
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (!pattern.test(normalized)) {
    fields.push({ field, message });
  }
  return normalized;
}

function parseRequiredIsoInstant(value, field, fields) {
  if (typeof value !== "string" || !isoInstantPattern.test(value.trim())) {
    fields.push({
      field,
      message: `${field} must be an ISO 8601 time with Z or a UTC offset`,
    });
    return undefined;
  }

  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    fields.push({
      field,
      message: `${field} must be a valid ISO 8601 time`,
    });
    return undefined;
  }
  return parsed;
}

function parseReason(value) {
  if (typeof value !== "string") {
    throw adminReasonRequired();
  }
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw adminReasonRequired();
  }
  return reason;
}

function validatePathId(request, parameterName, next) {
  const fields = [];
  parseObjectId(request.params[parameterName], parameterName, fields);
  if (fields.length > 0) {
    return next(invalidRequest(fields));
  }
  return next();
}

export function validateAdminUserList(request, _response, next) {
  try {
    const fields = [];
    let query = null;
    if (request.query.q !== undefined) {
      if (typeof request.query.q !== "string") {
        fields.push({ field: "q", message: "q must be a string" });
      } else {
        query = request.query.q.trim();
        if (query.length < 1 || query.length > 100) {
          fields.push({
            field: "q",
            message: "q must contain from 1 to 100 characters",
          });
        }
      }
    }

    const status = parseEnum(request.query.status, "status", userStatuses, fields);
    const role = parseEnum(request.query.role, "role", userRoles, fields);
    const page = parsePagination(request.query.page, "page", 1, 10000, fields);
    const limit = parsePagination(request.query.limit, "limit", 20, 50, fields);

    if (fields.length > 0) {
      throw invalidRequest(fields);
    }
    request.validatedQuery = { query, status, role, page, limit };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAdminUserId(request, _response, next) {
  return validatePathId(request, "userId", next);
}

export function validateAdminUserStatus(request, _response, next) {
  try {
    const body = requestBody(request);
    const fields = [];
    rejectUnknownFields(body, new Set(["status", "reason"]), fields);
    const status = parseEnum(body.status, "status", userStatuses, fields, {
      optional: false,
    });
    if (fields.length > 0) {
      throw invalidRequest(fields);
    }
    request.validatedBody = { status, reason: parseReason(body.reason) };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAdminBookingList(request, _response, next) {
  try {
    const fields = [];
    const userId = parseObjectId(request.query.userId, "userId", fields, {
      optional: true,
    });
    const flightId = parseObjectId(request.query.flightId, "flightId", fields, {
      optional: true,
    });
    let bookingReference = null;
    if (request.query.bookingReference !== undefined) {
      if (typeof request.query.bookingReference !== "string") {
        fields.push({
          field: "bookingReference",
          message: "bookingReference must be a string",
        });
      } else {
        bookingReference = request.query.bookingReference.trim().toUpperCase();
        if (
          bookingReference.length < 1 ||
          bookingReference.length > 16 ||
          !/^[A-Z0-9]+$/.test(bookingReference)
        ) {
          fields.push({
            field: "bookingReference",
            message: "bookingReference must contain 1 to 16 letters or digits",
          });
        }
      }
    }

    const status = parseEnum(
      request.query.status,
      "status",
      bookingStatuses,
      fields,
    );
    const source = parseEnum(
      request.query.source,
      "source",
      bookingSources,
      fields,
    );
    const createdFrom = parseDate(request.query.createdFrom, "createdFrom", fields);
    const createdTo = parseDate(request.query.createdTo, "createdTo", fields);
    const page = parsePagination(request.query.page, "page", 1, 10000, fields);
    const limit = parsePagination(request.query.limit, "limit", 20, 50, fields);

    if (createdFrom && createdTo && createdFrom > createdTo) {
      fields.push({
        field: "createdTo",
        message: "createdTo must not be earlier than createdFrom",
      });
    }
    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedQuery = {
      userId,
      flightId,
      bookingReference,
      status,
      source,
      createdFrom,
      createdTo,
      page,
      limit,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAdminBookingId(request, _response, next) {
  return validatePathId(request, "bookingId", next);
}

export function validateAdminCancellation(request, _response, next) {
  try {
    const body = requestBody(request);
    const fields = [];
    rejectUnknownFields(body, new Set(["reason"]), fields);
    if (fields.length > 0) {
      throw invalidRequest(fields);
    }
    request.validatedBody = { reason: parseReason(body.reason) };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAdminFlightList(request, _response, next) {
  try {
    const fields = [];
    const flightNumber = parseOptionalCode(
      request.query.flightNumber,
      "flightNumber",
      flightNumberPattern,
      "flightNumber must contain 2 to 12 letters or digits",
      fields,
    );
    const airlineCode = parseOptionalCode(
      request.query.airlineCode,
      "airlineCode",
      airlineCodePattern,
      "airlineCode must be a two- or three-character airline code",
      fields,
    );
    const origin = parseOptionalCode(
      request.query.origin,
      "origin",
      airportCodePattern,
      "origin must be a three-letter IATA airport code",
      fields,
    );
    const destination = parseOptionalCode(
      request.query.destination,
      "destination",
      airportCodePattern,
      "destination must be a three-letter IATA airport code",
      fields,
    );
    const status = parseEnum(
      request.query.status,
      "status",
      flightStatuses,
      fields,
    );
    const departureFrom = parseDate(
      request.query.departureFrom,
      "departureFrom",
      fields,
    );
    const departureTo = parseDate(
      request.query.departureTo,
      "departureTo",
      fields,
    );
    const page = parsePagination(request.query.page, "page", 1, 10000, fields);
    const limit = parsePagination(request.query.limit, "limit", 20, 50, fields);

    const sortBy = request.query.sortBy ?? "departureAt";
    if (typeof sortBy !== "string" || !adminFlightSortFields.has(sortBy)) {
      fields.push({
        field: "sortBy",
        message:
          "sortBy must be departureAt, arrivalAt, availableSeats, price, or createdAt",
      });
    }
    const sortOrder = request.query.sortOrder ?? "asc";
    if (
      typeof sortOrder !== "string" ||
      !["asc", "desc"].includes(sortOrder.toLowerCase())
    ) {
      fields.push({
        field: "sortOrder",
        message: "sortOrder must be asc or desc",
      });
    }

    if (origin && destination && origin === destination) {
      fields.push({
        field: "destination",
        message: "origin and destination must be different",
      });
    }
    if (departureFrom && departureTo && departureFrom > departureTo) {
      fields.push({
        field: "departureTo",
        message: "departureTo must not be earlier than departureFrom",
      });
    }
    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedQuery = {
      flightNumber,
      airlineCode,
      origin,
      destination,
      status,
      departureFrom,
      departureTo,
      page,
      limit,
      sortBy,
      sortOrder: sortOrder.toLowerCase(),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAdminFlightId(request, _response, next) {
  return validatePathId(request, "flightId", next);
}

export function validateAdminFlightSchedule(request, _response, next) {
  try {
    const body = requestBody(request);
    const fields = [];
    rejectUnknownFields(
      body,
      new Set([
        "departureAt",
        "arrivalAt",
        "reason",
        "expectedScheduleVersion",
      ]),
      fields,
    );

    const departureAt = parseRequiredIsoInstant(
      body.departureAt,
      "departureAt",
      fields,
    );
    const arrivalAt = parseRequiredIsoInstant(
      body.arrivalAt,
      "arrivalAt",
      fields,
    );
    const expectedScheduleVersion = body.expectedScheduleVersion;
    if (
      !Number.isSafeInteger(expectedScheduleVersion) ||
      expectedScheduleVersion < 0
    ) {
      fields.push({
        field: "expectedScheduleVersion",
        message: "expectedScheduleVersion must be a non-negative safe integer",
      });
    }
    if (departureAt && arrivalAt && arrivalAt <= departureAt) {
      fields.push({
        field: "arrivalAt",
        message: "arrivalAt must be later than departureAt",
      });
    }
    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedBody = {
      departureAt,
      arrivalAt,
      expectedScheduleVersion,
      reason: parseReason(body.reason),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAdminFlightUpdate(request, _response, next) {
  try {
    const body = requestBody(request);
    const fields = [];
    rejectUnknownFields(
      body,
      new Set(["status", "priceCents", "reason"]),
      fields,
    );

    const hasStatus = Object.hasOwn(body, "status");
    const hasPriceCents = Object.hasOwn(body, "priceCents");
    if (!hasStatus && !hasPriceCents) {
      fields.push({
        field: "body",
        message: "At least one of status or priceCents is required",
      });
    }

    const status = hasStatus
      ? parseEnum(body.status, "status", flightStatuses, fields, {
          optional: false,
        })
      : null;
    let priceCents = null;
    if (hasPriceCents) {
      priceCents = body.priceCents;
      if (!Number.isSafeInteger(priceCents) || priceCents < 1) {
        fields.push({
          field: "priceCents",
          message: "priceCents must be a positive safe integer",
        });
      }
    }

    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedBody = {
      hasStatus,
      hasPriceCents,
      status,
      priceCents,
      reason: hasStatus ? parseReason(body.reason) : null,
    };
    next();
  } catch (error) {
    next(error);
  }
}
