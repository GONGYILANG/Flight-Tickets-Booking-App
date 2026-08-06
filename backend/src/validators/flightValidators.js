import mongoose from "mongoose";

const airportCodePattern = /^[A-Z]{3}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const allowedSortFields = new Set([
  "departureAt",
  "arrivalAt",
  "availableSeats",
]);

function invalidRequest(fields) {
  const error = new Error("One or more request parameters are invalid");
  error.code = "INVALID_REQUEST";
  error.statusCode = 400;
  error.details = { fields };
  return error;
}

function parseAirportCode(value, field, fields) {
  if (typeof value !== "string") {
    fields.push({ field, message: `${field} is required` });
    return undefined;
  }

  const code = value.trim().toUpperCase();
  if (!airportCodePattern.test(code)) {
    fields.push({
      field,
      message: `${field} must be a three-letter IATA airport code`,
    });
  }
  return code;
}

function parseDepartureDate(value, fields) {
  if (typeof value !== "string" || !datePattern.test(value)) {
    fields.push({
      field: "departureDate",
      message: "departureDate is required in YYYY-MM-DD format",
    });
    return undefined;
  }

  const start = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== value
  ) {
    fields.push({
      field: "departureDate",
      message: "departureDate must be a valid calendar date",
    });
    return undefined;
  }

  return value;
}

function parseInteger(value, field, defaultValue, minimum, maximum, fields) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fields.push({
      field,
      message: `${field} must be an integer from ${minimum} to ${maximum}`,
    });
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    fields.push({
      field,
      message: `${field} must be an integer from ${minimum} to ${maximum}`,
    });
  }
  return parsed;
}

export function validateFlightSearch(request, _response, next) {
  try {
    const fields = [];
    const origin = parseAirportCode(request.query.origin, "origin", fields);
    const destination = parseAirportCode(
      request.query.destination,
      "destination",
      fields,
    );
    const departureDate = parseDepartureDate(
      request.query.departureDate,
      fields,
    );
    const passengers = parseInteger(
      request.query.passengers,
      "passengers",
      1,
      1,
      9,
      fields,
    );
    const page = parseInteger(request.query.page, "page", 1, 1, 10000, fields);
    const limit = parseInteger(request.query.limit, "limit", 20, 1, 50, fields);

    const sortBy = request.query.sortBy ?? "departureAt";
    if (typeof sortBy !== "string" || !allowedSortFields.has(sortBy)) {
      fields.push({
        field: "sortBy",
        message: "sortBy must be departureAt, arrivalAt, or availableSeats",
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

    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedQuery = {
      origin,
      destination,
      departureDate,
      passengers,
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

export function validateFlightId(request, _response, next) {
  if (!mongoose.isObjectIdOrHexString(request.params.flightId)) {
    return next(invalidRequest([
      { field: "flightId", message: "flightId must be a valid ObjectId" },
    ]));
  }

  return next();
}
