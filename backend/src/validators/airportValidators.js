function invalidRequest(fields) {
  const error = new Error("One or more request parameters are invalid");
  error.code = "INVALID_REQUEST";
  error.statusCode = 400;
  error.details = { fields };
  return error;
}

function parseLimit(value, fields) {
  if (value === undefined) {
    return 10;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fields.push({
      field: "limit",
      message: "limit must be an integer from 1 to 20",
    });
    return undefined;
  }

  const limit = Number.parseInt(value, 10);
  if (limit < 1 || limit > 20) {
    fields.push({
      field: "limit",
      message: "limit must be an integer from 1 to 20",
    });
  }
  return limit;
}

export function validateAirportSearch(request, _response, next) {
  try {
    const fields = [];
    let query;

    if (typeof request.query.q !== "string") {
      fields.push({ field: "q", message: "q is required" });
    } else {
      query = request.query.q.trim();
      if (query.length < 1 || query.length > 80) {
        fields.push({
          field: "q",
          message: "q must contain from 1 to 80 characters",
        });
      }
    }

    const limit = parseLimit(request.query.limit, fields);

    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedQuery = { query, limit };
    next();
  } catch (error) {
    next(error);
  }
}
