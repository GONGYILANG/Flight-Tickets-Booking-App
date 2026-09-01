export function serviceError(code, message, statusCode, details) {
  return Object.assign(
    new Error(message),
    { code, statusCode },
    details && { details },
  );
}

export function invalidRequest(
  fields,
  message = "One or more request fields are invalid",
) {
  return serviceError("INVALID_REQUEST", message, 400, { fields });
}
