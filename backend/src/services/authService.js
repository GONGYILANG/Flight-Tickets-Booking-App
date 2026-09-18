import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { authConfig } from "../config/auth.js";
import { serviceError } from "../errors.js";
import User from "../models/User.js";

export function toSafeUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role ?? "USER",
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
      jwtid: randomUUID(),
    },
  );
}

async function authResult(user) {
  const accessToken = issueAccessToken(user);
  // prune expired strings on login; use a session collection if history grows large.
  const expiredTokens = (user.tokens ?? []).filter(
    (token) => !(jwt.decode(token)?.exp > Date.now() / 1000),
  );
  if (expiredTokens.length) {
    await User.updateOne(
      { _id: user._id },
      { $pull: { tokens: { $in: expiredTokens } } },
    );
  }
  const result = await User.updateOne(
    { _id: user._id, status: "ACTIVE" },
    { $push: { tokens: accessToken } },
  );
  if (!result.matchedCount) {
    throw serviceError("ACCOUNT_NOT_ACTIVE", "This account is not active", 403);
  }
  return {
    user: toSafeUser(user),
    accessToken: accessToken,
    tokenType: "Bearer",
    expiresIn: authConfig.jwtExpiresIn,
  };
}

export async function registerUser({ email, password, displayName }) {
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
  const user = await User.findOne({ email }).select("+passwordHash +tokens");
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
      typeof payload.sub !== "string" ||
      !Number.isInteger(payload.exp)
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

export async function logoutUser(user, accessToken) {
  await User.updateOne({ _id: user._id }, { $pull: { tokens: accessToken } });
}
