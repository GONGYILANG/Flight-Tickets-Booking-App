import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authConfig } from "../config/auth.js";
import User from "../models/User.js";

function serviceError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function toSafeUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    status: user.status,
  };
}

function issueAccessToken(user) {
  return jwt.sign(
    { type: "access" },
    authConfig.jwtSecret,
    {
      algorithm: authConfig.jwtAlgorithm,
      subject: user._id.toString(),
      issuer: authConfig.jwtIssuer,
      audience: authConfig.jwtAudience,
      expiresIn: authConfig.jwtExpiresIn,
    },
  );
}

function authResult(user) {
  return {
    user: toSafeUser(user),
    accessToken: issueAccessToken(user),
    tokenType: "Bearer",
    expiresIn: authConfig.jwtExpiresIn,
  };
}

export async function registerUser({ email, password, displayName }) {
  const existingUser = await User.exists({ email });
  if (existingUser) {
    throw serviceError(
      "EMAIL_ALREADY_REGISTERED",
      "An account with this email already exists",
      409,
    );
  }

  const passwordHash = await bcrypt.hash(password, authConfig.bcryptCost);

  try {
    const user = await User.create({ email, passwordHash, displayName });
    return authResult(user);
  } catch (error) {
    if (error?.code === 11000) {
      throw serviceError(
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists",
        409,
      );
    }
    throw error;
  }
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select("+passwordHash");
  const passwordMatches = user
    ? await bcrypt.compare(password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    throw serviceError(
      "INVALID_CREDENTIALS",
      "Email or password is incorrect",
      401,
    );
  }

  if (user.status !== "ACTIVE") {
    throw serviceError(
      "ACCOUNT_NOT_ACTIVE",
      "This account is not active",
      403,
    );
  }

  return authResult(user);
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, authConfig.jwtSecret, {
      algorithms: [authConfig.jwtAlgorithm],
      issuer: authConfig.jwtIssuer,
      audience: authConfig.jwtAudience,
    });

    if (
      typeof payload !== "object" ||
      payload.type !== "access" ||
      typeof payload.sub !== "string"
    ) {
      throw serviceError("INVALID_TOKEN", "Access token is invalid", 401);
    }

    return payload;
  } catch (error) {
    if (error?.code === "INVALID_TOKEN") {
      throw error;
    }
    if (error?.name === "TokenExpiredError") {
      throw serviceError("TOKEN_EXPIRED", "Access token has expired", 401);
    }
    throw serviceError("INVALID_TOKEN", "Access token is invalid", 401);
  }
}
