import mongoose from "mongoose";
import { serviceError } from "../errors.js";
import Session from "../models/Session.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireObjectId(value, fieldName) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw serviceError("INVALID_ID", `${fieldName} is not a valid ObjectId`, 400);
  }
}

function requireUuid(value, fieldName) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw serviceError("INVALID_ID", `${fieldName} is not a canonical UUID`, 400);
  }
}

function toIsoString(value) {
  return new Date(value).toISOString();
}

function toSessionSummary(session) {
  return {
    sessionId: session.sessionId,
    createdAt: toIsoString(session.createdAt),
    updatedAt: toIsoString(session.updatedAt),
    lastAccess: toIsoString(session.lastAccess),
  };
}

function toSessionResponse(session) {
  return {
    ...toSessionSummary(session),
    history: session.history,
  };
}

function sessionNotFound() {
  return serviceError("SESSION_NOT_FOUND", "Session was not found", 404);
}

export async function createSession({ userId, sessionId }) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");

  try {
    const session = await Session.create({ sessionId, user: userId });
    return { session: toSessionResponse(session), alreadyExists: false };
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    const existing = await Session.findOne({ sessionId, user: userId }).lean();
    if (existing) {
      return { session: toSessionResponse(existing), alreadyExists: true };
    }
    throw serviceError("SESSION_ID_CONFLICT", "sessionId is unavailable", 409);
  }
}

export async function listSessionsForUser({ userId, page = 1, limit = 20 }) {
  requireObjectId(userId, "userId");
  const filter = { user: userId };
  const skip = (page - 1) * limit;
  const [sessions, totalItems] = await Promise.all([
    Session.find(filter)
      .select("sessionId createdAt updatedAt lastAccess")
      .sort({ user: 1, lastAccess: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Session.countDocuments(filter),
  ]);

  return {
    sessions: sessions.map(toSessionSummary),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
}

export async function getSessionForUser({ userId, sessionId }) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");
  const session = await Session.findOneAndUpdate(
    { sessionId, user: userId },
    { $set: { lastAccess: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!session) {
    throw sessionNotFound();
  }
  return toSessionResponse(session);
}

export async function appendSessionMessages({ userId, sessionId, messages }) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");
  const result = await Session.updateOne(
    { sessionId, user: userId },
    {
      $push: { history: { $each: messages } },
      $set: { lastAccess: new Date() },
    },
  );
  if (result.matchedCount !== 1) {
    throw sessionNotFound();
  }
}

export async function deleteSessionForUser({ userId, sessionId }) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");
  await Session.deleteOne({ sessionId, user: userId });
}
