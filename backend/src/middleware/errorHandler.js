const serviceErrorStatuses = {
  INVALID_REQUEST: 400,
  INVALID_ID: 400,
  INVALID_SEAT_COUNT: 400,
  INVALID_SOURCE: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  USER_NOT_FOUND: 404,
  FLIGHT_NOT_FOUND: 404,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  ACCOUNT_NOT_ACTIVE: 403,
  ADMIN_REQUIRED: 403,
  ADMIN_REASON_REQUIRED: 400,
  ADMIN_SELF_STATUS_FORBIDDEN: 409,
  LAST_ACTIVE_ADMIN: 409,
  INVALID_STATUS_TRANSITION: 409,
  USER_STATUS_CONFLICT: 409,
  FLIGHT_PRICE_NOT_EDITABLE: 409,
  FLIGHT_UPDATE_CONFLICT: 409,
  FLIGHT_SCHEDULE_NOT_EDITABLE: 409,
  FLIGHT_SCHEDULE_CONFLICT: 409,
  FLIGHT_SCHEDULE_IN_PAST: 409,
  INVALID_FLIGHT_SCHEDULE: 400,
  ADMIN_CONSISTENCY_ERROR: 500,
  EMAIL_ALREADY_REGISTERED: 409,
  FLIGHT_NOT_FOUND_OR_SOLD_OUT: 409,
  BOOKING_NOT_FOUND_OR_ALREADY_CANCELLED: 409,
  BOOKING_NOT_FOUND: 404,
  BOOKING_NOT_CANCELLABLE: 409,
  BOOKING_CREATION_FAILED: 500,
  BOOKING_CONSISTENCY_ERROR: 500,
  BOOKING_WRITES_PAUSED: 503,
  IDEMPOTENCY_KEY_CONFLICT: 409,
};

export function errorHandler(error, _request, response, _next) {
  let statusCode =
    error.statusCode || serviceErrorStatuses[error.code] || 500;
  let code = error.code || "INTERNAL_SERVER_ERROR";
  let message = error.message || "An unexpected error occurred";

  if (error.name === "ValidationError") {
    statusCode = 400;
    code = "VALIDATION_ERROR";
  } else if (error.name === "CastError") {
    statusCode = 400;
    code = "INVALID_ID";
    message = `Invalid value for ${error.path}`;
  } else if (error.code === 11000) {
    statusCode = 409;
    code = "DUPLICATE_VALUE";
    message = "A record with the same unique value already exists";
  }

  if (statusCode >= 500) {
    console.error(error);
  }

  const errorBody = {
    error: {
      code,
      message:
        statusCode >= 500 && process.env.NODE_ENV === "production"
          ? "Internal server error"
          : message,
    },
  };

  if (error.details && statusCode < 500) {
    errorBody.error.details = error.details;
  }

  response.status(statusCode).json(errorBody);
}
