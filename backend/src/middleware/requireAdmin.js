function authorizationError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function requireAdmin(request, _response, next) {
  if (request.user?.role !== "ADMIN") {
    return next(
      authorizationError(
        "ADMIN_REQUIRED",
        "Administrator access is required",
        403,
      ),
    );
  }

  return next();
}
