import User from "../models/User.js";
import { verifyAccessToken } from "../services/authService.js";

function authError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export async function authenticate(request, _response, next) {
  try {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      throw authError(
        "AUTH_REQUIRED",
        "A Bearer access token is required",
        401,
      );
    }

    const payload = verifyAccessToken(match[1]);
    const user = await User.findById(payload.sub);

    if (!user) {
      throw authError("INVALID_TOKEN", "Access token is invalid", 401);
    }

    if (user.status !== "ACTIVE") {
      throw authError(
        "ACCOUNT_NOT_ACTIVE",
        "This account is not active",
        403,
      );
    }

    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
