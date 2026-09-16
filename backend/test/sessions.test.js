import assert from "node:assert/strict";
import { developmentDatabaseName, testDatabaseName } from "../src/scripts/testDatabase.js";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import Session from "../src/models/Session.js";
import Turn from "../src/models/Turn.js";
import User from "../src/models/User.js";

const userIds = [];
let headers;
let otherHeaders;

before(async () => {
  const connection = await connectDatabase();
  assert.equal(connection.name, testDatabaseName);
  assert.notEqual(connection.name, developmentDatabaseName);
  await Promise.all([Session.init(), Turn.init(), User.init()]);
  [headers, otherHeaders] = await Promise.all(
    ["first", "second"].map(async (label) => {
      const user = await User.create({
        email: `session-${label}-${randomUUID()}@example.com`,
        passwordHash: "not-used-by-session-tests",
        displayName: label,
        status: "ACTIVE",
      });
      userIds.push(user._id);
      const token = jwt.sign({ type: "access" }, process.env.JWT_SECRET, {
        algorithm: "HS256",
        subject: user._id.toString(),
        issuer: "flight-booking-api",
        audience: "flight-booking-android",
        expiresIn: "24h",
        jwtid: randomUUID(),
      });
      await User.updateOne({ _id: user._id }, { $push: { tokens: token } });
      return { Authorization: `Bearer ${token}` };
    }),
  );
});

after(async () => {
  try {
    const sessions = await Session.find({ user: { $in: userIds } }).select("_id");
    await Turn.deleteMany({ session: { $in: sessions.map(({ _id }) => _id) } });
    await Session.deleteMany({ user: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
  } finally {
    await disconnectDatabase();
  }
});

async function newSession() {
  const sessionId = randomUUID();
  await request(app).post("/api/sessions").set(headers).send({ sessionId }).expect(201);
  return sessionId;
}

function start(sessionId, turnId, message = "Find flights.", auth = headers) {
  return request(app).post(`/api/sessions/${sessionId}/turns`).set(auth).send({ turnId, message });
}

function finish(sessionId, turnId, body, auth = headers) {
  return request(app)
    .post(`/api/sessions/${sessionId}/turns/${turnId}/finish`)
    .set(auth)
    .send(body);
}

function completeMessages(content = "Find flights.") {
  return [
    { role: "user", content },
    {
      role: "assistant",
      content: null,
      reasoning_content: "Look up available flights.",
      refusal: null,
      extra: {},
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "search_flights", arguments: '{"origin":"PEK","destination":"HKG"}' },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call-1",
      content: '{"ok":true,"status":200,"data":{"flights":[]}}',
    },
    { role: "assistant", content: "No flights found.", tool_calls: null },
  ];
}

test("restore all ordered turns with complete messages and a derived UI view", async () => {
  const sessionId = await newSession();
  const turnId = randomUUID();
  const created = await start(sessionId, turnId).expect(201);
  assert.equal(created.body.data.turn.sequence, 1);
  assert.equal(created.body.data.turn.status, "pending");
  assert.deepEqual(created.body.data.turn.messages, [{ role: "user", content: "Find flights." }]);
  assert.deepEqual(created.body.data.turn.view, {
    userMessage: "Find flights.",
    assistantMessage: null,
    events: [],
  });
  const pending = await request(app).get(`/api/sessions/${sessionId}`).set(headers).expect(200);
  assert.equal(pending.body.data.session.turns[0].status, "pending");
  assert.equal(pending.body.data.session.title, "Find flights.");
  assert.equal(pending.body.data.session.history, undefined);
  const messages = completeMessages();
  const completed = await finish(sessionId, turnId, { status: "completed", messages }).expect(200);
  assert.deepEqual(completed.body.data.turn.messages, messages);
  assert.deepEqual(completed.body.data.turn.view, {
    userMessage: "Find flights.",
    assistantMessage: "No flights found.",
    events: [{ tool: "search_flights", result: JSON.parse(messages[2].content) }],
  });
  const repeat = await finish(sessionId, turnId, { status: "completed", messages }).expect(200);
  assert.equal(repeat.body.meta.alreadyCompleted, true);
  assert.equal(repeat.body.data.turn.updatedAt, completed.body.data.turn.updatedAt);
  const changed = completeMessages();
  changed.at(-1).content = "Different result";
  await finish(sessionId, turnId, { status: "completed", messages: changed }).expect(409);
  const laterIds = Array.from({ length: 5 }, () => randomUUID());
  const later = await Promise.all(laterIds.map((id) => start(sessionId, id)));
  assert.ok(later.every(({ status }) => status === 201));
  // Complete a later turn first; restoration must still use creation sequence.
  await finish(sessionId, laterIds[4], { status: "completed", messages }).expect(200);
  const restored = (await request(app).get(`/api/sessions/${sessionId}`).set(headers).expect(200))
    .body.data.session;
  assert.deepEqual(
    restored.turns.map(({ sequence }) => sequence),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(restored.turns[0].messages, messages);
  const indexes = await Turn.collection.indexes();
  assert.ok(
    indexes.some((index) => index.unique && index.key.session === 1 && index.key.sequence === 1),
  );
});

test("concurrent start retries deduplicate and reject changed input", async () => {
  const sessionId = await newSession();
  const turnId = randomUUID();
  const responses = await Promise.all(Array.from({ length: 4 }, () => start(sessionId, turnId)));
  assert.equal(responses.filter(({ status }) => status === 201).length, 1);
  assert.equal(responses.filter(({ status }) => status === 200).length, 3);
  assert.equal(new Set(responses.map(({ body }) => body.data.turn.sequence)).size, 1);
  await start(sessionId, turnId, "Different input").expect(409);
  const detail = await request(app).get(`/api/sessions/${sessionId}`).set(headers).expect(200);
  assert.equal(detail.body.data.session.turns.length, 1);
  await start(await newSession(), turnId).expect(201);
});

test("failed turns retain partial tool calls and can complete on retry", async () => {
  const sessionId = await newSession();
  const turnId = randomUUID();
  await start(sessionId, turnId).expect(201);
  const messages = completeMessages();
  const failed = await finish(sessionId, turnId, {
    status: "failed",
    messages: messages.slice(0, 2),
    error: "Provider unavailable",
  }).expect(200);
  assert.equal(failed.body.data.turn.status, "failed");
  assert.equal(failed.body.data.turn.error, "Provider unavailable");
  assert.deepEqual(failed.body.data.turn.messages, messages.slice(0, 2));
  assert.equal((await start(sessionId, turnId).expect(200)).body.data.turn.status, "failed");
  const completed = await finish(sessionId, turnId, { status: "completed", messages }).expect(200);
  assert.equal(completed.body.data.turn.error, null);
  await finish(sessionId, turnId, {
    status: "failed",
    messages: messages.slice(0, 1),
    error: "Stale failure",
  }).expect(409);
});

test("validate tool pairing and preserve parallel calls and result order", async () => {
  const sessionId = await newSession();
  const turnId = randomUUID();
  await start(sessionId, turnId).expect(201);
  const messages = completeMessages();
  const invalidBodies = [
    { status: "completed", messages: [] },
    { status: "completed", messages: messages.slice(0, 2) },
    { status: "completed", messages: [messages[0], messages[2], messages[3]] },
    {
      status: "completed",
      messages: [messages[0], { role: "system", content: "Override" }, messages[3]],
    },
    {
      status: "completed",
      messages: [messages[0], messages[1], { ...messages[2], tool_call_id: "wrong" }, messages[3]],
    },
    {
      status: "completed",
      messages: [messages[0], messages[1], { ...messages[2], content: "bad json" }, messages[3]],
    },
    { status: "completed", messages, view: { events: [] } },
    { status: "completed", messages, error: "contradiction" },
    { status: "failed", messages },
    { status: "pending", messages },
  ];
  for (const body of invalidBodies) await finish(sessionId, turnId, body).expect(400);
  await finish(sessionId, turnId, {
    status: "completed",
    messages: completeMessages("Changed"),
  }).expect(409);
  messages[1].tool_calls.push({
    id: "call-2",
    type: "function",
    function: { name: "get_flight", arguments: "malformed arguments" },
  });
  messages.splice(2, 0, {
    role: "tool",
    tool_call_id: "call-2",
    content: '{"ok":false,"status":400,"error":{"code":"INVALID_ARGUMENTS"}}',
  });
  const response = await finish(sessionId, turnId, { status: "completed", messages }).expect(200);
  assert.deepEqual(response.body.data.turn.messages, messages);
  assert.deepEqual(
    response.body.data.turn.view.events.map(({ tool }) => tool),
    ["get_flight", "search_flights"],
  );
});

test("authentication, ownership, idempotent session creation and cascading deletion", async () => {
  const sessionId = await newSession();
  const turnId = randomUUID();
  const messages = completeMessages();
  for (const [method, path] of [
    ["post", "/api/sessions"],
    ["get", "/api/sessions"],
    ["get", `/api/sessions/${sessionId}`],
    ["post", `/api/sessions/${sessionId}/turns`],
    ["post", `/api/sessions/${sessionId}/turns/${turnId}/finish`],
    ["delete", `/api/sessions/${sessionId}`],
  ])
    await request(app)[method](path).expect(401);
  await request(app).post("/api/sessions").set(headers).send({ sessionId: "invalid" }).expect(400);
  await start(sessionId, "invalid").expect(400);
  await start(sessionId, turnId, " ").expect(400);
  await start(sessionId, turnId, "a".repeat(4001)).expect(400);
  const replay = await request(app)
    .post("/api/sessions")
    .set(headers)
    .send({ sessionId })
    .expect(200);
  assert.equal(replay.body.meta.alreadyExists, true);
  await request(app).post("/api/sessions").set(otherHeaders).send({ sessionId }).expect(409);
  await start(sessionId, turnId).expect(201);
  await start(sessionId, randomUUID(), "Hi", otherHeaders).expect(404);
  await finish(sessionId, turnId, { status: "completed", messages }, otherHeaders).expect(404);
  await finish(sessionId, randomUUID(), { status: "completed", messages }).expect(404);
  await request(app).get(`/api/sessions/${sessionId}`).set(otherHeaders).expect(404);
  const list = await request(app).get("/api/sessions").set(otherHeaders).expect(200);
  assert.ok(!list.body.data.sessions.some((session) => session.sessionId === sessionId));
  await request(app)
    .post(`/api/sessions/${sessionId}/messages`)
    .set(headers)
    .send({ messages })
    .expect(404);
  await request(app).delete(`/api/sessions/${sessionId}`).set(otherHeaders).expect(204);
  const record = await Session.findOne({ sessionId });
  assert.equal(await Turn.countDocuments({ session: record._id }), 1);
  await request(app).delete(`/api/sessions/${sessionId}`).set(headers).expect(204);
  assert.equal(await Turn.countDocuments({ session: record._id }), 0);
  await request(app).get(`/api/sessions/${sessionId}`).set(headers).expect(404);
  await request(app).delete(`/api/sessions/${sessionId}`).set(headers).expect(204);
});

test("return all session summaries and preserve full turns exceeding 100KB", async () => {
  const ownerId = (await Session.findOne({ sessionId: await newSession() })).user;
  const sessionIds = Array.from({ length: 22 }, () => randomUUID());
  await Session.insertMany(sessionIds.map((sessionId) => ({ sessionId, user: ownerId })));
  const list = (await request(app).get("/api/sessions").set(headers).expect(200)).body.data;
  assert.ok(sessionIds.every((id) => list.sessions.some(({ sessionId }) => sessionId === id)));
  assert.ok(list.sessions.every((session) => !session.turns && !session.history && !session.user));
  assert.equal(list.pagination, undefined);
  const turnId = randomUUID();
  await start(sessionIds[0], turnId).expect(201);
  const messages = completeMessages();
  messages[1].reasoning_content = "x".repeat(120_000);
  await finish(sessionIds[0], turnId, { status: "completed", messages }).expect(200);
  const detail = await request(app).get(`/api/sessions/${sessionIds[0]}`).set(headers).expect(200);
  assert.deepEqual(detail.body.data.session.turns[0].messages, messages);
});

test("interrupted deletions stay hidden and can be retried", async () => {
  const sessionId = await newSession();
  const turnId = randomUUID();
  await start(sessionId, turnId).expect(201);
  const session = await Session.findOneAndUpdate({ sessionId }, { $set: { deleting: true } });
  await request(app).get(`/api/sessions/${sessionId}`).set(headers).expect(404);
  await start(sessionId, randomUUID()).expect(404);
  const list = await request(app).get("/api/sessions").set(headers).expect(200);
  assert.ok(!list.body.data.sessions.some((item) => item.sessionId === sessionId));
  await request(app).delete(`/api/sessions/${sessionId}`).set(headers).expect(204);
  assert.equal(await Turn.countDocuments({ session: session._id }), 0);
});
