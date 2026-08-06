const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidRequest(fields) {
  const error = new Error("One or more request fields are invalid");
  error.code = "INVALID_REQUEST";
  error.statusCode = 400;
  error.details = { fields };
  return error;
}

function validateEmail(value, fields) {
  if (typeof value !== "string") {
    fields.push({ field: "email", message: "Email is required" });
    return undefined;
  }

  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 320 || !emailPattern.test(email)) {
    fields.push({ field: "email", message: "Email format is invalid" });
  }
  return email;
}

function validatePassword(value, fields) {
  if (typeof value !== "string") {
    fields.push({ field: "password", message: "Password is required" });
    return undefined;
  }

  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength < 8 || byteLength > 72) {
    fields.push({
      field: "password",
      message: "Password must be between 8 and 72 bytes",
    });
  }
  return value;
}

function validateDisplayName(value, fields) {
  if (typeof value !== "string") {
    fields.push({ field: "displayName", message: "Display name is required" });
    return undefined;
  }

  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 120) {
    fields.push({
      field: "displayName",
      message: "Display name must be between 2 and 120 characters",
    });
  }
  return displayName;
}

function requestBody(request) {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw invalidRequest([{ field: "body", message: "A JSON object is required" }]);
  }
  return request.body;
}

export function validateRegister(request, _response, next) {
  try {
    const body = requestBody(request);
    const fields = [];
    const email = validateEmail(body.email, fields);
    const password = validatePassword(body.password, fields);
    const displayName = validateDisplayName(body.displayName, fields);

    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedBody = { email, password, displayName };
    next();
  } catch (error) {
    next(error);
  }
}

export function validateLogin(request, _response, next) {
  try {
    const body = requestBody(request);
    const fields = [];
    const email = validateEmail(body.email, fields);
    const password = validatePassword(body.password, fields);

    if (fields.length > 0) {
      throw invalidRequest(fields);
    }

    request.validatedBody = { email, password };
    next();
  } catch (error) {
    next(error);
  }
}
