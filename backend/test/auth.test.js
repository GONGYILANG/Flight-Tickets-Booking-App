import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";

process.env.NODE_ENV = "test";

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
  assert.equal(response.body.database.name, process.env.MONGODB_DB_NAME);
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
  assert.equal(data.tokenType, "Bearer");
  assert.equal(data.expiresIn, "2h");
  assert.equal(typeof accessToken, "string");
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);

  const storedUser = await User.findOne({ email: testEmail }).select(
    "+passwordHash",
  );
  assert.ok(storedUser);
  assert.notEqual(storedUser.passwordHash, password);
  assert.equal(bcrypt.getRounds(storedUser.passwordHash), 12);
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
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: testEmail.toUpperCase(), password })
    .expect(200);

  accessToken = response.body.data.accessToken;
  assert.equal(response.body.data.user.email, testEmail);
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
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

test("me returns the current safe user for a valid token", async () => {
  const response = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${accessToken}`)
    .expect(200);

  assert.equal(response.body.data.user.email, testEmail);
  assert.equal(response.body.data.user.status, "ACTIVE");
  assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
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
