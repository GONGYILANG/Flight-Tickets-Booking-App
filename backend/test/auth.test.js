import assert from "node:assert/strict";
import { testDatabaseName } from "../src/scripts/testDatabase.js";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";

const [{ default: app }, databaseModule, userModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/database.js"),
  import("../src/models/User.js"),
]);

const { connectDatabase, disconnectDatabase } = databaseModule;
const { default: User } = userModule;

const testEmail = `auth-test-${randomUUID()}@example.com`;
const password = "ValidPassword123!";
let accessToken;
let testUserId;

before(async () => {
  await connectDatabase();
  await User.init();
});

after(async () => {
  try {
    await User.deleteMany({ email: testEmail });
    const remainingUsers = await User.countDocuments({ email: testEmail });
    assert.equal(remainingUsers, 0, "The authentication test user was not cleaned up");
  } finally {
    await disconnectDatabase();
  }
});

test("health endpoint remains available", async () => {
  const response = await request(app).get("/api/health").expect(200);

  assert.equal(response.body.status, "ok");
  assert.equal(response.body.database.name, testDatabaseName);
});

test("register rejects invalid fields", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send({ email: "invalid", password: "short", displayName: " " })
    .expect(400);

  assert.equal(response.body.error.code, "INVALID_REQUEST");
  assert.deepEqual(
    response.body.error.details.fields.map(({ field }) => field),
    ["email", "password", "displayName"],
  );
});

test("register creates an active user and automatically logs in", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send({
      email: testEmail.toUpperCase(),
      password,
      displayName: "  Authentication Test User  ",
    })
    .expect(201);

  const { data } = response.body;
  accessToken = data.accessToken;
  testUserId = data.user.id;

  assert.equal(data.user.email, testEmail);
  assert.equal(data.user.displayName, "Authentication Test User");
  assert.equal(data.user.status, "ACTIVE");
  assert.equal(data.user.role, "USER");
  assert.equal(data.tokenType, "Bearer");
  assert.equal(data.expiresIn, "24h");
  const payload = jwt.decode(accessToken);
  assert.equal(payload.exp - payload.iat, 24 * 60 * 60);
  assert.equal(typeof accessToken, "string");
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);

  const storedUser = await User.findOne({ email: testEmail }).select(
    "+passwordHash +tokens",
  );
  assert.ok(storedUser);
  assert.notEqual(storedUser.passwordHash, password);
  assert.equal(bcrypt.getRounds(storedUser.passwordHash), 12);
  assert.deepEqual([...storedUser.tokens], [accessToken]);
  assert.equal("tokens" in data.user, false);
});

test("register rejects an email that is already registered", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send({ email: testEmail, password, displayName: "Duplicate User" })
    .expect(409);

  assert.equal(response.body.error.code, "EMAIL_ALREADY_REGISTERED");
});

test("login returns the same error for an unknown email and wrong password", async () => {
  const wrongPasswordResponse = await request(app)
    .post("/api/auth/login")
    .send({ email: testEmail, password: "WrongPassword123!" })
    .expect(401);

  const unknownEmailResponse = await request(app)
    .post("/api/auth/login")
    .send({
      email: `unknown-${randomUUID()}@example.com`,
      password: "WrongPassword123!",
    })
    .expect(401);

  assert.equal(wrongPasswordResponse.body.error.code, "INVALID_CREDENTIALS");
  assert.equal(unknownEmailResponse.body.error.code, "INVALID_CREDENTIALS");
  assert.equal(
    wrongPasswordResponse.body.error.message,
    unknownEmailResponse.body.error.message,
  );
});

test("login accepts the correct password without leaking the hash", async () => {
  const registrationToken = accessToken;
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: testEmail.toUpperCase(), password })
    .expect(200);

  accessToken = response.body.data.accessToken;
  assert.equal(response.body.data.user.email, testEmail);
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
  assert.notEqual(accessToken, registrationToken);
  const stored = await User.findById(testUserId).select("+tokens");
  assert.ok(stored.tokens.includes(accessToken));
  assert.ok(stored.tokens.includes(registrationToken));
  assert.equal("tokens" in response.body.data.user, false);
});

test("me rejects missing, forged, and expired tokens", async () => {
  const missingResponse = await request(app).get("/api/auth/me").expect(401);
  assert.equal(missingResponse.body.error.code, "AUTH_REQUIRED");

  const forgedResponse = await request(app)
    .get("/api/auth/me")
    .set("Authorization", "Bearer not-a-real-jwt")
    .expect(401);
  assert.equal(forgedResponse.body.error.code, "INVALID_TOKEN");

  const expiredToken = jwt.sign(
    { type: "access" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      subject: testUserId,
      issuer: "flight-booking-api",
      audience: "flight-booking-android",
      expiresIn: -1,
    },
  );
  const expiredResponse = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${expiredToken}`)
    .expect(401);
  assert.equal(expiredResponse.body.error.code, "TOKEN_EXPIRED");
});

test("a signed token must be saved and have an expiry before it can authenticate", async () => {
  const options = {
    algorithm: "HS256", subject: testUserId, issuer: "flight-booking-api",
    audience: "flight-booking-android", jwtid: randomUUID(),
  };
  const unsaved = jwt.sign({ type: "access" }, process.env.JWT_SECRET, { ...options, expiresIn: "24h" });
  const response = await request(app).get("/api/auth/me")
    .set("Authorization", `Bearer ${unsaved}`).expect(401);
  assert.equal(response.body.error.code, "TOKEN_REVOKED");
  const noExpiry = jwt.sign({ type: "access" }, process.env.JWT_SECRET, options);
  const expired = jwt.sign({ type: "access" }, process.env.JWT_SECRET, { ...options, expiresIn: -1 });
  await User.updateOne({ _id: testUserId }, { $push: { tokens: { $each: [noExpiry, expired] } } });
  for (const [token, code] of [[noExpiry, "INVALID_TOKEN"], [expired, "TOKEN_EXPIRED"]]) {
    const rejected = await request(app).get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`).expect(401);
    assert.equal(rejected.body.error.code, code);
  }
});

test("concurrent logins keep distinct raw tokens and prune expired records", async () => {
  const responses = await Promise.all(Array.from({ length: 3 }, () => request(app)
    .post("/api/auth/login").send({ email: testEmail, password }).expect(200)));
  const newTokens = responses.map((response) => response.body.data.accessToken);
  assert.equal(new Set(newTokens).size, 3);
  const stored = await User.findById(testUserId).select("+tokens");
  for (const token of [accessToken, ...newTokens]) assert.ok(stored.tokens.includes(token));
  for (const token of stored.tokens) {
    assert.ok(jwt.decode(token).exp > Date.now() / 1000);
  }
  const publicUser = await User.findById(testUserId).lean();
  assert.equal("tokens" in publicUser, false);
});

test("me returns the current safe user for a valid token", async () => {
  const response = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .expect(200);

  assert.equal(response.body.data.user.email, testEmail);
  assert.equal(response.body.data.user.status, "ACTIVE");
  assert.equal(response.body.data.user.role, "USER");
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
});

test("logout removes only the current raw token and leaves other sessions valid", async () => {
  const oldToken = accessToken;
  await request(app).post("/api/auth/logout").expect(401);
  const secondLogin = await request(app).post("/api/auth/login")
    .send({ email: testEmail, password }).expect(200);
  await request(app).post("/api/auth/logout")
    .set("Authorization", `Bearer ${oldToken}`).expect(204);
  const response = await request(app).get("/api/auth/me")
    .set("Authorization", `Bearer ${oldToken}`).expect(401);
  assert.equal(response.body.error.code, "TOKEN_REVOKED");
  await request(app).post("/api/auth/logout")
    .set("Authorization", `Bearer ${oldToken}`).expect(401);
  await request(app).get("/api/auth/me")
    .set("Authorization", `Bearer ${secondLogin.body.data.accessToken}`).expect(200);
  const stored = await User.findById(testUserId).select("+tokens").lean();
  assert.equal(stored.tokens.includes(oldToken), false);
  assert.equal(stored.tokens.includes(secondLogin.body.data.accessToken), true);
  const login = await request(app).post("/api/auth/login")
    .send({ email: testEmail, password }).expect(200);
  accessToken = login.body.data.accessToken;
  assert.notEqual(accessToken, oldToken);
  const me = await request(app).get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`).expect(200);
  assert.equal("tokens" in me.body.data.user, false);
});

test("me rejects an old token after the account is locked or disabled", async () => {
  for (const status of ["LOCKED", "DISABLED"]) {
    await User.updateOne({ email: testEmail }, { $set: { status } });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);

    assert.equal(response.body.error.code, "ACCOUNT_NOT_ACTIVE");
  }
});
