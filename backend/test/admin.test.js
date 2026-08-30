import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import "dotenv/config";
import jwt from "jsonwebtoken";
import request from "supertest";

const developmentDatabaseName = process.env.MONGODB_DB_NAME || "flightBookingDB";
const testDatabaseName = process.env.MONGODB_TEST_DB_NAME?.trim();
if (!testDatabaseName) {
  throw new Error(
    "MONGODB_TEST_DB_NAME is required; Admin tests never use the development database",
  );
}
if (testDatabaseName.toLowerCase() === developmentDatabaseName.toLowerCase()) {
  throw new Error("MONGODB_TEST_DB_NAME must be different from MONGODB_DB_NAME");
}

process.env.NODE_ENV = "test";
process.env.MONGODB_DB_NAME = testDatabaseName;

const [
  { default: app },
  databaseModule,
  { default: Airline },
  { default: Airport },
  { default: Booking },
  { default: Flight },
  { default: User },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/database.js"),
  import("../src/models/Airline.js"),
  import("../src/models/Airport.js"),
  import("../src/models/Booking.js"),
  import("../src/models/Flight.js"),
  import("../src/models/User.js"),
]);

const { connectDatabase, disconnectDatabase } = databaseModule;
const createdUserIds = [];
const createdFlightIds = [];
const createdAirportIds = [];
const createdAirlineIds = [];
let airline;
let originAirport;
let destinationAirport;
let admin;
let normalUser;
let otherUser;
let adminToken;
let normalToken;

function tokenFor(subject) {
  return jwt.sign({ type: "access" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    subject: subject.toString(),
    issuer: "flight-booking-api",
    audience: "flight-booking-android",
    expiresIn: "2h",
  });
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` };
}

function randomLetters(length) {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(65 + (bytes[index] % 26)),
  ).join("");
}

async function createUser(label, role = "USER") {
  const user = await User.create({
    email: `admin-test-${label}-${randomUUID()}@example.com`.toLowerCase(),
    passwordHash: "not-used-by-admin-tests",
    displayName: `Admin Test ${label}`,
    status: "ACTIVE",
    role,
  });
  createdUserIds.push(user._id);
  return user;
}

async function createFlight({
  totalSeats = 10,
  availableSeats = totalSeats,
  priceCents = 30000,
  status = "SCHEDULED",
} = {}) {
  const departureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const flight = await Flight.create({
    airline: airline._id,
    flightNumber: `AT${randomUUID().replaceAll("-", "").slice(0, 8)}`,
    originAirport: originAirport._id,
    destinationAirport: destinationAirport._id,
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 3 * 60 * 60 * 1000),
    priceCents,
    totalSeats,
    availableSeats,
    status,
  });
  createdFlightIds.push(flight._id);
  return flight;
}

function bookingData({ user, flight, seatCount = 1, status = "CONFIRMED" }) {
  const key = randomUUID();
  return {
    bookingReference: `BK${key.replaceAll("-", "").slice(0, 12)}`,
    user: user._id,
    flight: flight._id,
    seatCount,
    source: "UI",
    status,
    idempotencyKey: key,
    priceSnapshot: {
      unitPriceCents: flight.priceCents,
      totalPriceCents: flight.priceCents * seatCount,
      currency: "USD",
    },
    cancelledAt: status === "CANCELLED" ? new Date() : null,
    cancellationSource: status === "CANCELLED" ? "USER" : null,
    cancelledBy: status === "CANCELLED" ? user._id : null,
    cancellationReason: null,
  };
}

before(async () => {
  const connection = await connectDatabase();
  assert.equal(connection.name, testDatabaseName);
  await Promise.all([
    Airline.init(),
    Airport.init(),
    Booking.init(),
    Flight.init(),
    User.init(),
  ]);

  airline = await Airline.create({
    code: randomLetters(3),
    name: `Admin Test Airline ${randomUUID()}`,
    active: true,
  });
  createdAirlineIds.push(airline._id);

  let firstCode = randomLetters(3);
  let secondCode = randomLetters(3);
  while (secondCode === firstCode) {
    secondCode = randomLetters(3);
  }
  [originAirport, destinationAirport] = await Airport.create([
    {
      iataCode: firstCode,
      name: `Admin Origin ${randomUUID()}`,
      cityName: "Admin Origin",
      countryCode: "SG",
      timezone: "Asia/Singapore",
    },
    {
      iataCode: secondCode,
      name: `Admin Destination ${randomUUID()}`,
      cityName: "Admin Destination",
      countryCode: "HK",
      timezone: "Asia/Hong_Kong",
    },
  ]);
  createdAirportIds.push(originAirport._id, destinationAirport._id);

  [admin, normalUser, otherUser] = await Promise.all([
    createUser("administrator", "ADMIN"),
    createUser("normal-user"),
    createUser("other-user"),
  ]);
  adminToken = tokenFor(admin._id);
  normalToken = tokenFor(normalUser._id);
});

after(async () => {
  try {
    await Booking.deleteMany({ user: { $in: createdUserIds } });
    await Flight.deleteMany({ _id: { $in: createdFlightIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await Airport.deleteMany({ _id: { $in: createdAirportIds } });
    await Airline.deleteMany({ _id: { $in: createdAirlineIds } });
  } finally {
    await disconnectDatabase();
  }
});

test("registration cannot assign ADMIN and authentication returns the role", async () => {
  const email = `admin-role-spoof-${randomUUID()}@example.com`;
  const response = await request(app)
    .post("/api/auth/register")
    .send({
      email,
      password: "ValidPassword123!",
      displayName: "Role Spoof Test",
      role: "ADMIN",
    })
    .expect(201);
  createdUserIds.push(response.body.data.user.id);

  assert.equal(response.body.data.user.role, "USER");
  assert.equal((await User.findOne({ email })).role, "USER");
});

test("admin routes require live ADMIN authorization", async () => {
  await request(app).get("/api/admin/users").expect(401);
  const forbidden = await request(app)
    .get("/api/admin/users")
    .set(authorization(normalToken))
    .expect(403);
  assert.equal(forbidden.body.error.code, "ADMIN_REQUIRED");

  await request(app)
    .get("/api/admin/users")
    .set(authorization(adminToken))
    .expect(200);

  await User.updateOne({ _id: admin._id }, { $set: { role: "USER" } });
  try {
    const demoted = await request(app)
      .get("/api/admin/users")
      .set(authorization(adminToken))
      .expect(403);
    assert.equal(demoted.body.error.code, "ADMIN_REQUIRED");
  } finally {
    await User.updateOne({ _id: admin._id }, { $set: { role: "ADMIN" } });
  }
});

test("administrators can search users and inspect booking summaries safely", async () => {
  const flight = await createFlight();
  await Booking.create(bookingData({ user: normalUser, flight }));

  const list = await request(app)
    .get(
      `/api/admin/users?q=${encodeURIComponent(normalUser.email)}&status=ACTIVE&role=USER&page=1&limit=10`,
    )
    .set(authorization(adminToken))
    .expect(200);
  assert.equal(list.body.data.users.length, 1);
  assert.equal(list.body.data.users[0].id, normalUser._id.toString());
  assert.equal(list.body.data.users[0].role, "USER");
  assert.equal(JSON.stringify(list.body).includes("passwordHash"), false);

  const detail = await request(app)
    .get(`/api/admin/users/${normalUser._id}`)
    .set(authorization(adminToken))
    .expect(200);
  assert.ok(detail.body.data.bookingSummary.total >= 1);
  assert.ok(detail.body.data.bookingSummary.confirmed >= 1);
});

test("administrators can lock and restore users but cannot lock themselves", async () => {
  const locked = await request(app)
    .patch(`/api/admin/users/${normalUser._id}/status`)
    .set(authorization(adminToken))
    .send({ status: "LOCKED", reason: "Account review" })
    .expect(200);
  assert.equal(locked.body.meta.changed, true);
  assert.equal(locked.body.data.user.status, "LOCKED");

  const oldToken = await request(app)
    .get("/api/auth/me")
    .set(authorization(normalToken))
    .expect(403);
  assert.equal(oldToken.body.error.code, "ACCOUNT_NOT_ACTIVE");

  const replay = await request(app)
    .patch(`/api/admin/users/${normalUser._id}/status`)
    .set(authorization(adminToken))
    .send({ status: "LOCKED", reason: "Account review" })
    .expect(200);
  assert.equal(replay.body.meta.changed, false);

  await request(app)
    .patch(`/api/admin/users/${normalUser._id}/status`)
    .set(authorization(adminToken))
    .send({ status: "ACTIVE", reason: "Review completed" })
    .expect(200);

  const self = await request(app)
    .patch(`/api/admin/users/${admin._id}/status`)
    .set(authorization(adminToken))
    .send({ status: "DISABLED", reason: "Self disable" })
    .expect(409);
  assert.equal(self.body.error.code, "ADMIN_SELF_STATUS_FORBIDDEN");

  const missingReason = await request(app)
    .patch(`/api/admin/users/${otherUser._id}/status`)
    .set(authorization(adminToken))
    .send({ status: "LOCKED" })
    .expect(400);
  assert.equal(missingReason.body.error.code, "ADMIN_REASON_REQUIRED");
});

test("global booking management filters records without exposing internal fields", async () => {
  const flight = await createFlight();
  const [first, second] = await Booking.create([
    bookingData({ user: normalUser, flight }),
    bookingData({ user: otherUser, flight, status: "CANCELLED" }),
  ]);

  const list = await request(app)
    .get(`/api/admin/bookings?userId=${normalUser._id}&status=CONFIRMED`)
    .set(authorization(adminToken))
    .expect(200);
  assert.ok(list.body.data.bookings.some(({ id }) => id === first._id.toString()));
  assert.ok(
    list.body.data.bookings.every(
      ({ user, status }) => user.id === normalUser._id.toString() && status === "CONFIRMED",
    ),
  );

  const detail = await request(app)
    .get(`/api/admin/bookings/${second._id}`)
    .set(authorization(adminToken))
    .expect(200);
  assert.equal(detail.body.data.booking.user.email, otherUser.email);
  assert.equal(detail.body.data.booking.cancellation.source, "USER");
  const serialized = JSON.stringify(detail.body);
  assert.equal(serialized.includes("idempotencyKey"), false);
  assert.equal(serialized.includes("priceSnapshot"), false);
  assert.equal(serialized.includes("passwordHash"), false);
});

test("concurrent administrator cancellation restores inventory once", async () => {
  const flight = await createFlight({ totalSeats: 3, availableSeats: 1 });
  const booking = await Booking.create(
    bookingData({ user: normalUser, flight, seatCount: 2 }),
  );

  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      request(app)
        .patch(`/api/admin/bookings/${booking._id}/cancel`)
        .set(authorization(adminToken))
        .send({ reason: "Customer support cancellation" }),
    ),
  );
  assert.ok(responses.every(({ status }) => status === 200));
  assert.equal(
    responses.filter(({ body }) => body.meta.alreadyCancelled === false).length,
    1,
  );
  const storedBooking = await Booking.findById(booking._id);
  assert.equal(storedBooking.status, "CANCELLED");
  assert.equal(storedBooking.cancellationSource, "ADMIN");
  assert.ok(storedBooking.cancelledBy.equals(admin._id));
  assert.equal((await Flight.findById(flight._id)).availableSeats, 3);
});

test("flight price updates preserve old snapshots and affect new bookings", async () => {
  const flight = await createFlight({ totalSeats: 5, availableSeats: 4 });
  const oldBooking = await Booking.create(
    bookingData({ user: normalUser, flight, seatCount: 1 }),
  );

  const updated = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ priceCents: 45555 })
    .expect(200);
  assert.deepEqual(updated.body.meta.changedFields, ["priceCents"]);
  assert.equal(updated.body.data.flight.priceCents, 45555);
  assert.equal(updated.body.data.flight.price.amount, "455.55");
  assert.equal((await Booking.findById(oldBooking._id)).priceSnapshot.unitPriceCents, 30000);

  const created = await request(app)
    .post("/api/bookings")
    .set(authorization(tokenFor(otherUser._id)))
    .send({
      flightId: flight._id.toString(),
      seatCount: 1,
      source: "UI",
      idempotencyKey: randomUUID(),
    })
    .expect(201);
  assert.equal(created.body.data.booking.pricing.unitAmount, "455.55");
});

test("flight PATCH validates fields and enforces status transitions", async () => {
  const flight = await createFlight();
  const unknown = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ totalSeats: 99 })
    .expect(400);
  assert.equal(unknown.body.error.code, "INVALID_REQUEST");

  const missingReason = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ status: "DELAYED" })
    .expect(400);
  assert.equal(missingReason.body.error.code, "ADMIN_REASON_REQUIRED");

  const invalid = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ status: "ARRIVED", reason: "Invalid direct arrival" })
    .expect(409);
  assert.equal(invalid.body.error.code, "INVALID_STATUS_TRANSITION");

  const delayed = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ status: "DELAYED", reason: "Weather delay" })
    .expect(200);
  assert.deepEqual(delayed.body.meta.changedFields, ["status"]);
  assert.equal(delayed.body.data.flight.status, "DELAYED");
  assert.equal(delayed.body.data.flight.statusReason, "Weather delay");

  const replay = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ status: "DELAYED", reason: "Weather delay" })
    .expect(200);
  assert.equal(replay.body.meta.changed, false);
});

test("cancelling a flight cancels confirmed bookings and is idempotent", async () => {
  const flight = await createFlight({ totalSeats: 5, availableSeats: 2 });
  const bookings = await Booking.create([
    bookingData({ user: normalUser, flight, seatCount: 1 }),
    bookingData({ user: otherUser, flight, seatCount: 2 }),
  ]);

  const cancelled = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ status: "CANCELLED", reason: "Operational cancellation" })
    .expect(200);
  assert.equal(cancelled.body.meta.affectedBookings, 2);
  assert.equal(cancelled.body.data.flight.status, "CANCELLED");
  assert.equal(cancelled.body.data.flight.availableSeats, 5);

  const storedBookings = await Booking.find({
    _id: { $in: bookings.map(({ _id }) => _id) },
  });
  assert.ok(storedBookings.every(({ status }) => status === "CANCELLED"));
  assert.ok(
    storedBookings.every(
      ({ cancellationSource }) => cancellationSource === "FLIGHT",
    ),
  );

  const replay = await request(app)
    .patch(`/api/admin/flights/${flight._id}`)
    .set(authorization(adminToken))
    .send({ status: "CANCELLED", reason: "Operational cancellation" })
    .expect(200);
  assert.equal(replay.body.meta.changed, false);
  assert.equal(replay.body.meta.affectedBookings, 0);

  const myBookings = await request(app)
    .get("/api/bookings/me")
    .set(authorization(tokenFor(normalUser._id)))
    .expect(200);
  const visible = myBookings.body.data.bookings.find(
    ({ id }) => id === bookings[0]._id.toString(),
  );
  assert.deepEqual(visible.cancellation, {
    source: "FLIGHT",
    reason: "Operational cancellation",
  });
});

test("administrator indexes support the new stable list queries", async () => {
  const [userIndexes, bookingIndexes] = await Promise.all([
    User.collection.indexes(),
    Booking.collection.indexes(),
  ]);
  assert.ok(
    userIndexes.some(
      ({ key }) => key.createdAt === -1 && key._id === -1,
    ),
  );
  assert.ok(
    bookingIndexes.some(
      ({ key }) => key.createdAt === -1 && key._id === -1,
    ),
  );
});
