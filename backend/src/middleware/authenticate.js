import mongoose from "mongoose";
import { serviceError } from "../errors.js";
import User from "../models/User.js";
import { verifyAccessToken } from "../services/authService.js";

export async function authenticate(request, _response, next) {
  try {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      throw serviceError(
        "AUTH_REQUIRED",
        "A Bearer access token is required",
        401,
      );
    }

    const payload = verifyAccessToken(match[1]);
    if (!mongoose.isObjectIdOrHexString(payload.sub)) {
      throw serviceError("INVALID_TOKEN", "Access token is invalid", 401);
    }

    const user = await User.findById(payload.sub).select("+tokens");

    if (!user) {
      throw serviceError("INVALID_TOKEN", "Access token is invalid", 401);
    }

    if (!user.tokens.includes(match[1])) {
      throw serviceError("TOKEN_REVOKED", "Access token has been revoked", 401);
    }

    if (user.status !== "ACTIVE") {
      throw serviceError(
        "ACCOUNT_NOT_ACTIVE",
        "This account is not active",
        403,
      );
    }

    request.user = user;
    request.accessToken = match[1];
    next();
  } catch (error) {
    next(error);
  }
}
