import assert from "node:assert/strict";
import { developmentDatabaseName, testDatabaseName } from "../src/scripts/testDatabase.js";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import "dotenv/config";
import jwt from "jsonwebtoken";
import request from "supertest";

const [{ default: app }, databaseModule, { default: Session }, { default: User }] =
  await Promise.all([
    import("../src/app.js"),
    import("../src/config/database.js"),
    import("../src/models/Session.js"),
    import("../src/models/User.js"),
  ]);

const { connectDatabase, disconnectDatabase } = databaseModule;
const userIds = [];
let firstUser;
let secondUser;
let firstToken;
let secondToken;

function accessTokenFor(subject) {
  return jwt.sign(
    { type: "access" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      subject: subject.toString(),
      issuer: "flight-booking-api",
      audience: "flight-booking-android",
      expiresIn: "24h",
      jwtid: randomUUID(),
    },
  );
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createUser(label) {
  const user = await User.create({
    email: `session-${label}-${randomUUID()}@example.com`,
    passwordHash: "not-used-by-session-tests",
    displayName: `Session ${label}`,
    status: "ACTIVE",
  });
  userIds.push(user._id);
  return user;
}

before(async () => {
  const connection = await connectDatabase();
  assert.equal(connection.name, testDatabaseName);
  assert.notEqual(connection.name, developmentDatabaseName);
  await Promise.all([Session.init(), User.init()]);
  [firstUser, secondUser] = await Promise.all([
    createUser("first"),
    createUser("second"),
  ]);
  firstToken = accessTokenFor(firstUser._id);
  secondToken = accessTokenFor(secondUser._id);
  await Promise.all([
    User.updateOne({ _id: firstUser._id }, { $push: { tokens: firstToken } }),
    User.updateOne({ _id: secondUser._id }, { $push: { tokens: secondToken } }),
  ]);
});

after(async () => {
  try {
    await Session.deleteMany({ user: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
  } finally {
    await disconnectDatabase();
  }
});

test("session APIs persist flat message history with user scoping", async () => {
  const sessionId = randomUUID();
  const firstHeaders = authorization(firstToken);
  const secondHeaders = authorization(secondToken);

  await request(app).post("/api/sessions").send({ sessionId }).expect(401);
  const invalid = await request(app)
    .post("/api/sessions")
    .set(firstHeaders)
    .send({ sessionId: "invalid" })
    .expect(400);
  assert.equal(invalid.body.error.details.fields[0].field, "sessionId");

  const created = await request(app)
    .post("/api/sessions")
    .set(firstHeaders)
    .send({ sessionId })
    .expect(201);
  assert.equal(created.body.data.session.sessionId, sessionId);
  assert.deepEqual(created.body.data.session.history, []);
  assert.equal(created.body.meta.alreadyExists, false);

  const replayedCreate = await request(app)
    .post("/api/sessions")
    .set(firstHeaders)
    .send({ sessionId })
    .expect(200);
  assert.equal(replayedCreate.body.meta.alreadyExists, true);
  const conflict = await request(app)
    .post("/api/sessions")
    .set(secondHeaders)
    .send({ sessionId })
    .expect(409);
  assert.equal(conflict.body.error.code, "SESSION_ID_CONFLICT");

  const messages = [
    { role: "user", content: "Find a flight to Hong Kong." },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1" }] },
    { role: "tool", tool_call_id: "call-1", content: '{"flights":[]}' },
    { role: "assistant", content: "No flights found." },
  ];
  await request(app)
    .post(`/api/sessions/${sessionId}/messages`)
    .set(firstHeaders)
    .send({ messages })
    .expect(204);

  const invalidMessages = await request(app)
    .post(`/api/sessions/${sessionId}/messages`)
    .set(firstHeaders)
    .send({ messages: [{ role: "unknown", content: "bad" }] })
    .expect(400);
  assert.equal(invalidMessages.body.error.details.fields[0].field, "messages");
  await request(app)
    .post(`/api/sessions/${sessionId}/messages`)
    .set(secondHeaders)
    .send({ messages })
    .expect(404);
  await request(app)
    .post(`/api/sessions/${sessionId}/turns`)
    .set(firstHeaders)
    .send({ messages })
    .expect(404);

  const concurrentMessages = [
    { role: "user", content: "Show my bookings." },
    { role: "assistant", content: "You have no bookings." },
  ];
  const concurrentResponses = await Promise.all(
    Array.from({ length: 4 }, () =>
      request(app)
        .post(`/api/sessions/${sessionId}/messages`)
        .set(firstHeaders)
        .send({ messages: concurrentMessages }),
    ),
  );
  assert.ok(concurrentResponses.every(({ status }) => status === 204));

  await request(app)
    .get(`/api/sessions/${sessionId}`)
    .set(secondHeaders)
    .expect(404);
  const detail = await request(app)
    .get(`/api/sessions/${sessionId}`)
    .set(firstHeaders)
    .expect(200);
  assert.equal(detail.body.data.session.history.length, 12);
  assert.deepEqual(
    detail.body.data.session.history.slice(0, 4),
    messages,
  );
  for (let index = 4; index < 12; index += 2) {
    assert.deepEqual(
      detail.body.data.session.history.slice(index, index + 2),
      concurrentMessages,
    );
  }

  const list = await request(app)
    .get("/api/sessions")
    .set(firstHeaders)
    .expect(200);
  assert.ok(list.body.data.sessions.some((session) => session.sessionId === sessionId));

  await request(app)
    .patch(`/api/sessions/${sessionId}/messages/0`)
    .set(firstHeaders)
    .send({ content: "changed" })
    .expect(404);
  await request(app)
    .delete(`/api/sessions/${sessionId}`)
    .set(secondHeaders)
    .expect(204);
  await request(app)
    .get(`/api/sessions/${sessionId}`)
    .set(firstHeaders)
    .expect(200);
  await request(app)
    .delete(`/api/sessions/${sessionId}`)
    .set(firstHeaders)
    .expect(204);
  await request(app)
    .get(`/api/sessions/${sessionId}`)
    .set(firstHeaders)
    .expect(404);
});
