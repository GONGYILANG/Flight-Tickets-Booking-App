export function notFoundHandler(request, _response, next) {
  const error = new Error(
    `Route not found: ${request.method} ${request.originalUrl}`,
  );
  error.statusCode = 404;
  error.code = "ROUTE_NOT_FOUND";
  next(error);
}
