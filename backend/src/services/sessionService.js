import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { serviceError } from "../errors.js";
import Session from "../models/Session.js";
import Turn from "../models/Turn.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    title: session.title ?? "New conversation",
    createdAt: toIsoString(session.createdAt),
    updatedAt: toIsoString(session.updatedAt),
    lastAccess: toIsoString(session.lastAccess),
  };
}

function toTurnResponse(turn) {
  return {
    turnId: turn.turnId,
    sequence: turn.sequence,
    status: turn.status,
    messages: turn.messages,
    view: turn.view,
    error: turn.error,
    createdAt: toIsoString(turn.createdAt),
    updatedAt: toIsoString(turn.updatedAt),
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
    return { session: toSessionSummary(session), alreadyExists: false };
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    const existing = await Session.findOne({
      sessionId,
      user: userId,
      deleting: { $ne: true },
    }).lean();
    if (existing) {
      return { session: toSessionSummary(existing), alreadyExists: true };
    }
    throw serviceError("SESSION_ID_CONFLICT", "sessionId is unavailable", 409);
  }
}

export async function listSessionsForUser({ userId }) {
  requireObjectId(userId, "userId");
  // ponytail: return all summaries for sidebar restoration; paginate if histories grow large.
  const sessions = await Session.find({ user: userId, deleting: { $ne: true } })
    .select("sessionId title createdAt updatedAt lastAccess")
    .sort({ user: 1, lastAccess: -1, _id: -1 })
    .lean();
  return { sessions: sessions.map(toSessionSummary) };
}

export async function getSessionForUser({ userId, sessionId }) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");
  const session = await Session.findOneAndUpdate(
    { sessionId, user: userId, deleting: { $ne: true } },
    { $set: { lastAccess: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!session) {
    throw sessionNotFound();
  }
  const turns = await Turn.find({ session: session._id }).sort({ session: 1, sequence: 1 }).lean();
  return { ...toSessionSummary(session), turns: turns.map(toTurnResponse) };
}

async function ownedSession(userId, sessionId) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");
  const session = await Session.findOne({
    sessionId,
    user: userId,
    deleting: { $ne: true },
  }).lean();
  if (!session) throw sessionNotFound();
  return session;
}

async function touchSession(session, turn) {
  const changes = { lastAccess: new Date() };
  if (turn.sequence === 1) changes.title = turn.view.userMessage.slice(0, 80);
  const updated = await Session.updateOne(
    { _id: session._id, deleting: { $ne: true } },
    { $set: changes },
  );
  if (!updated.matchedCount) {
    // A concurrent delete can finish before an in-flight turn insert does.
    await Turn.deleteOne({ _id: turn._id });
    throw sessionNotFound();
  }
}

function assertSameInput(turn, message) {
  if (turn.view.userMessage !== message) {
    throw serviceError("TURN_ID_CONFLICT", "turnId was used for a different user message", 409);
  }
}

export async function startTurn({ userId, sessionId, turnId, message }) {
  requireUuid(turnId, "turnId");
  const session = await ownedSession(userId, sessionId);
  const filter = { session: session._id, turnId };
  let turn = await Turn.findOne(filter).lean();
  let alreadyExists = Boolean(turn);
  if (!turn) {
    const allocated = await Session.findOneAndUpdate(
      { _id: session._id, deleting: { $ne: true } },
      { $inc: { nextSequence: 1 } },
      { returnDocument: "after" },
    ).lean();
    if (!allocated) throw sessionNotFound();
    try {
      turn = (
        await Turn.create({
          ...filter,
          sequence: allocated.nextSequence,
          messages: [{ role: "user", content: message }],
          view: { userMessage: message, assistantMessage: null, events: [] },
        })
      ).toObject();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      turn = await Turn.findOne(filter).lean();
      if (!turn) throw error;
      alreadyExists = true;
    }
  }
  assertSameInput(turn, message);
  await touchSession(session, turn);
  return { turn: toTurnResponse(turn), alreadyExists };
}

export async function finishTurn({ userId, sessionId, turnId, status, messages, view, error }) {
  requireUuid(turnId, "turnId");
  const session = await ownedSession(userId, sessionId);
  const filter = { session: session._id, turnId };
  const existing = await Turn.findOne(filter).lean();
  if (!existing) throw serviceError("TURN_NOT_FOUND", "Turn was not found", 404);
  assertSameInput(existing, messages[0].content);
  const result = { status, messages, view, error };
  let turn = await Turn.findOneAndUpdate(
    { ...filter, status: { $ne: "completed" } },
    { $set: result },
    { returnDocument: "after", runValidators: true },
  ).lean();
  const alreadyCompleted = !turn;
  if (!turn) {
    turn = await Turn.findOne(filter).lean();
    if (!turn) throw serviceError("TURN_NOT_FOUND", "Turn was not found", 404);
    if (!Object.entries(result).every(([key, value]) => isDeepStrictEqual(turn[key], value))) {
      throw serviceError("TURN_ALREADY_COMPLETED", "A completed turn cannot be overwritten", 409);
    }
  }
  await touchSession(session, turn);
  return { turn: toTurnResponse(turn), alreadyCompleted };
}

export async function deleteSessionForUser({ userId, sessionId }) {
  requireObjectId(userId, "userId");
  requireUuid(sessionId, "sessionId");
  // No cross-collection transaction requirement (the deployment uses Cosmos MongoDB).
  // The durable marker hides the session and lets a failed deletion be retried safely.
  const session = await Session.findOneAndUpdate(
    { sessionId, user: userId },
    { $set: { deleting: true } },
    { returnDocument: "after" },
  ).lean();
  if (!session) return;
  await Turn.deleteMany({ session: session._id });
  await Session.deleteOne({ _id: session._id });
}
