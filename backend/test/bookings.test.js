import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import "dotenv/config";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";

const developmentDatabaseName =
  process.env.MONGODB_DB_NAME || "flightBookingDB";
const testDatabaseName = process.env.MONGODB_TEST_DB_NAME?.trim();
if (!testDatabaseName) {
  throw new Error(
    "MONGODB_TEST_DB_NAME is required; Booking tests never use the development database",
  );
}
if (testDatabaseName.toLowerCase() === developmentDatabaseName.toLowerCase()) {
  throw new Error(
    "MONGODB_TEST_DB_NAME must be different from MONGODB_DB_NAME",
  );
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
let firstUser;
let secondUser;
let firstToken;
let secondToken;
let primaryFlight;
let primaryBookingId;
let primaryIdempotencyKey;
let secondUserBookingId;

function randomLetters(length) {
  let result = "";
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(65 + (bytes[index] % 26));
  }
  return result;
}

function accessTokenFor(subject) {
  return jwt.sign(
    { type: "access" },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      subject: subject.toString(),
      issuer: "flight-booking-api",
      audience: "flight-booking-android",
      expiresIn: "2h",
    },
  );
}

async function createUser(label) {
  const emailLabel = label.trim().toLowerCase().replaceAll(/\s+/g, "-");
  const user = await User.create({
    email: `booking-${emailLabel}-${randomUUID()}@example.com`,
    passwordHash: "not-used-by-booking-tests",
    displayName: `Booking ${label}`,
    status: "ACTIVE",
  });
  createdUserIds.push(user._id);
  return user;
}

async function createFlight({
  totalSeats = 10,
  availableSeats = totalSeats,
  priceCents = 32500,
  status = "SCHEDULED",
  departureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
} = {}) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const flight = await Flight.create({
    airline: airline._id,
    flightNumber: `BT${suffix}`,
    originAirport: originAirport._id,
    destinationAirport: destinationAirport._id,
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 3 * 60 * 60 * 1000),
    totalSeats,
    availableSeats,
    priceCents,
    status,
  });
  createdFlightIds.push(flight._id);
  return flight;
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` };
}

function bookingRequest(flightId, idempotencyKey = randomUUID(), overrides = {}) {
  return {
    flightId: flightId.toString(),
    seatCount: 1,
    source: "UI",
    idempotencyKey,
    ...overrides,
  };
}

function directBookingData({ user, flight, seatCount = 1, status = "CONFIRMED" }) {
  const uuid = randomUUID();
  return {
    bookingReference: `BK${uuid.replaceAll("-", "").slice(0, 12)}`,
    user: user._id,
    flight: flight._id,
    seatCount,
    source: "UI",
    status,
    idempotencyKey: uuid,
    priceSnapshot: {
      unitPriceCents: flight.priceCents,
      totalPriceCents: flight.priceCents * seatCount,
      currency: "USD",
    },
    cancelledAt: status === "CANCELLED" ? new Date() : null,
  };
}

before(async () => {
  const connection = await connectDatabase();
  assert.equal(connection.name, testDatabaseName);
  assert.notEqual(connection.name, developmentDatabaseName);

  await Promise.all([
    Airline.init(),
    Airport.init(),
    Booking.init(),
    Flight.init(),
    User.init(),
  ]);

  airline = await Airline.create({
    code: randomLetters(3),
    name: `Booking Test Airline ${randomUUID()}`,
    active: true,
  });
  createdAirlineIds.push(airline._id);

  const firstAirportCode = randomLetters(3);
  let secondAirportCode = randomLetters(3);
  while (secondAirportCode === firstAirportCode) {
    secondAirportCode = randomLetters(3);
  }
  [originAirport, destinationAirport] = await Airport.create([
    {
      iataCode: firstAirportCode,
      name: `Booking Test Origin ${randomUUID()}`,
      cityName: "Booking Origin",
      countryCode: "SG",
      timezone: "Asia/Singapore",
    },
    {
      iataCode: secondAirportCode,
      name: `Booking Test Destination ${randomUUID()}`,
      cityName: "Booking Destination",
      countryCode: "HK",
      timezone: "Asia/Hong_Kong",
    },
  ]);
  createdAirportIds.push(originAirport._id, destinationAirport._id);

  [firstUser, secondUser] = await Promise.all([
    createUser("First User"),
    createUser("Second User"),
  ]);
  firstToken = accessTokenFor(firstUser._id);
  secondToken = accessTokenFor(secondUser._id);
  primaryFlight = await createFlight({ totalSeats: 10 });
});

after(async () => {
  try {
    await Booking.deleteMany({ user: { $in: createdUserIds } });
    await Flight.deleteMany({ _id: { $in: createdFlightIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await Airport.deleteMany({ _id: { $in: createdAirportIds } });
    await Airline.deleteMany({ _id: { $in: createdAirlineIds } });

    const [bookingCount, flightCount, userCount] = await Promise.all([
      Booking.countDocuments({ user: { $in: createdUserIds } }),
      Flight.countDocuments({ _id: { $in: createdFlightIds } }),
      User.countDocuments({ _id: { $in: createdUserIds } }),
    ]);
    assert.equal(bookingCount, 0);
    assert.equal(flightCount, 0);
    assert.equal(userCount, 0);
  } finally {
    await disconnectDatabase();
  }
});

test("Booking endpoints require authentication and validate input", async () => {
  await request(app).post("/api/bookings").send({}).expect(401);
  await request(app).get("/api/bookings/me").expect(401);

  const invalidResponse = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send({
      flightId: "invalid",
      seatCount: 0,
      source: "BOT",
      idempotencyKey: "not-a-uuid",
    })
    .expect(400);
  assert.equal(invalidResponse.body.error.code, "INVALID_REQUEST");
  assert.deepEqual(
    invalidResponse.body.error.details.fields.map(({ field }) => field),
    ["flightId", "seatCount", "source", "idempotencyKey"],
  );

  const invalidPage = await request(app)
    .get("/api/bookings/me?page=0&limit=51")
    .set(authorization(firstToken))
    .expect(400);
  assert.deepEqual(
    invalidPage.body.error.details.fields.map(({ field }) => field),
    ["page", "limit"],
  );
});

test("a signed token with a non-ObjectId subject returns INVALID_TOKEN", async () => {
  const malformedSubjectToken = accessTokenFor("not-an-object-id");
  const response = await request(app)
    .get("/api/bookings/me")
    .set(authorization(malformedSubjectToken))
    .expect(401);
  assert.equal(response.body.error.code, "INVALID_TOKEN");
});

test("maintenance mode pauses Booking writes but keeps order history readable", async () => {
  process.env.BOOKING_WRITES_PAUSED = "true";
  try {
    const createResponse = await request(app)
      .post("/api/bookings")
      .set(authorization(firstToken))
      .send(bookingRequest(primaryFlight._id))
      .expect(503);
    assert.equal(createResponse.body.error.code, "BOOKING_WRITES_PAUSED");

    const cancelResponse = await request(app)
      .patch(`/api/bookings/${new mongoose.Types.ObjectId()}/cancel`)
      .set(authorization(firstToken))
      .expect(503);
    assert.equal(cancelResponse.body.error.code, "BOOKING_WRITES_PAUSED");

    await request(app)
      .get("/api/bookings/me")
      .set(authorization(firstToken))
      .expect(200);
  } finally {
    delete process.env.BOOKING_WRITES_PAUSED;
  }
});

test("creating and replaying a booking changes inventory exactly once", async () => {
  primaryIdempotencyKey = randomUUID();
  const body = bookingRequest(primaryFlight._id, primaryIdempotencyKey.toUpperCase(), {
    seatCount: 2,
    source: "ai",
    price: { amount: "0.01", currency: "USD" },
    priceSnapshot: {
      unitPriceCents: 1,
      totalPriceCents: 2,
      currency: "USD",
    },
  });

  const created = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(body)
    .expect(201);
  primaryBookingId = created.body.data.booking.id;
  assert.equal(created.body.meta.idempotentReplay, false);
  assert.equal(created.body.data.booking.seatCount, 2);
  assert.equal(created.body.data.booking.source, "AI");
  assert.equal(created.body.data.booking.status, "CONFIRMED");
  assert.equal(created.body.data.booking.flight.id, primaryFlight._id.toString());
  assert.deepEqual(created.body.data.booking.pricing, {
    unitAmount: "325.00",
    totalAmount: "650.00",
    currency: "USD",
  });

  const storedBooking = await Booking.findById(primaryBookingId).lean();
  assert.deepEqual(storedBooking.priceSnapshot, {
    unitPriceCents: 32500,
    totalPriceCents: 65000,
    currency: "USD",
  });

  let storedFlight = await Flight.findById(primaryFlight._id).lean();
  assert.equal(storedFlight.availableSeats, 8);

  const replayed = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send({ ...body, idempotencyKey: primaryIdempotencyKey, source: "AI" })
    .expect(200);
  assert.equal(replayed.body.meta.idempotentReplay, true);
  assert.equal(replayed.body.data.booking.id, primaryBookingId);
  assert.deepEqual(
    replayed.body.data.booking.pricing,
    created.body.data.booking.pricing,
  );
  assert.equal(
    await Booking.countDocuments({
      user: firstUser._id,
      idempotencyKey: primaryIdempotencyKey,
    }),
    1,
  );
  storedFlight = await Flight.findById(primaryFlight._id).lean();
  assert.equal(storedFlight.availableSeats, 8);

  const serialized = JSON.stringify(created.body.data.booking);
  for (const internalField of [
    "idempotencyKey",
    "priceSnapshot",
    '"user"',
    '"__v"',
  ]) {
    assert.equal(serialized.includes(internalField), false);
  }
});

test("booking pricing remains the original snapshot after the Flight price changes", async () => {
  await Flight.updateOne(
    { _id: primaryFlight._id },
    { $set: { priceCents: 49999 } },
  );

  try {
    const response = await request(app)
      .get("/api/bookings/me")
      .set(authorization(firstToken))
      .expect(200);
    const booking = response.body.data.bookings.find(
      ({ id }) => id === primaryBookingId,
    );
    assert.ok(booking);
    assert.deepEqual(booking.pricing, {
      unitAmount: "325.00",
      totalAmount: "650.00",
      currency: "USD",
    });

    const storedBooking = await Booking.findById(primaryBookingId).lean();
    assert.deepEqual(storedBooking.priceSnapshot, {
      unitPriceCents: 32500,
      totalPriceCents: 65000,
      currency: "USD",
    });
  } finally {
    await Flight.updateOne(
      { _id: primaryFlight._id },
      { $set: { priceCents: 32500 } },
    );
  }
});

test("reusing an idempotency key with a different request returns 409", async () => {
  const otherFlight = await createFlight();
  const variations = [
    { flightId: otherFlight._id.toString(), seatCount: 2, source: "AI" },
    { flightId: primaryFlight._id.toString(), seatCount: 3, source: "AI" },
    { flightId: primaryFlight._id.toString(), seatCount: 2, source: "UI" },
  ];

  for (const variation of variations) {
    const response = await request(app)
      .post("/api/bookings")
      .set(authorization(firstToken))
      .send({ ...variation, idempotencyKey: primaryIdempotencyKey })
      .expect(409);
    assert.equal(response.body.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  }
});

test("different users can reuse the same idempotency key", async () => {
  const response = await request(app)
    .post("/api/bookings")
    .set(authorization(secondToken))
    .send(bookingRequest(primaryFlight._id, primaryIdempotencyKey))
    .expect(201);
  secondUserBookingId = response.body.data.booking.id;
  assert.notEqual(secondUserBookingId, primaryBookingId);
  assert.equal((await Flight.findById(primaryFlight._id)).availableSeats, 7);
});

test("concurrent retries with one key create one booking and deduct once", async () => {
  const flight = await createFlight({ totalSeats: 5 });
  const idempotencyKey = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      request(app)
        .post("/api/bookings")
        .set(authorization(firstToken))
        .send(bookingRequest(flight._id, idempotencyKey)),
    ),
  );

  assert.equal(responses.filter(({ status }) => status === 201).length, 1);
  assert.equal(responses.filter(({ status }) => status === 200).length, 5);
  assert.equal(new Set(responses.map(({ body }) => body.data.booking.id)).size, 1);
  assert.equal(
    await Booking.countDocuments({ user: firstUser._id, idempotencyKey }),
    1,
  );
  assert.equal((await Flight.findById(flight._id)).availableSeats, 4);
});

test("different keys atomically compete for the last seats without going negative", async () => {
  const flight = await createFlight({ totalSeats: 2 });
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      request(app)
        .post("/api/bookings")
        .set(authorization(firstToken))
        .send(bookingRequest(flight._id)),
    ),
  );

  assert.equal(responses.filter(({ status }) => status === 201).length, 2);
  assert.equal(responses.filter(({ status }) => status === 409).length, 4);
  for (const response of responses.filter(({ status }) => status === 409)) {
    assert.equal(response.body.error.code, "FLIGHT_NOT_FOUND_OR_SOLD_OUT");
  }
  assert.equal((await Flight.findById(flight._id)).availableSeats, 0);
});

test("a known booking insert failure immediately compensates inventory", async () => {
  const flight = await createFlight({ totalSeats: 3 });
  const originalCreate = Booking.create;
  Booking.create = async () => {
    throw new Error("injected booking insert failure");
  };

  try {
    const response = await request(app)
      .post("/api/bookings")
      .set(authorization(firstToken))
      .send(bookingRequest(flight._id))
      .expect(500);
    assert.equal(response.body.error.code, "BOOKING_CREATION_FAILED");
  } finally {
    Booking.create = originalCreate;
  }

  assert.equal((await Flight.findById(flight._id)).availableSeats, 3);
});

test("an invalid Flight price is rejected and the deducted seats are compensated", async () => {
  const flight = await createFlight({ totalSeats: 3 });
  await Flight.collection.updateOne(
    { _id: flight._id },
    { $unset: { priceCents: "" } },
  );

  const response = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(bookingRequest(flight._id))
    .expect(500);
  assert.equal(response.body.error.code, "BOOKING_CREATION_FAILED");
  assert.equal((await Flight.findById(flight._id)).availableSeats, 3);
  assert.equal(await Booking.countDocuments({ flight: flight._id }), 0);
});

test("a failed create compensation returns a sanitized consistency error", async () => {
  const flight = await createFlight({ totalSeats: 3 });
  const originalCreate = Booking.create;
  const originalFlightUpdate = Flight.updateOne;
  Booking.create = async () => {
    throw new Error("injected booking insert failure");
  };
  Flight.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });

  try {
    const response = await request(app)
      .post("/api/bookings")
      .set(authorization(firstToken))
      .send(bookingRequest(flight._id))
      .expect(500);
    assert.equal(response.body.error.code, "BOOKING_CONSISTENCY_ERROR");
    assert.equal(JSON.stringify(response.body).includes("idempotency"), false);
  } finally {
    Booking.create = originalCreate;
    Flight.updateOne = originalFlightUpdate;
  }

  assert.equal((await Flight.findById(flight._id)).availableSeats, 2);
  await Flight.updateOne(
    { _id: flight._id, availableSeats: 2 },
    { $set: { availableSeats: 3 } },
  );
});

test("first, repeated, and concurrent cancellation restore seats only once", async () => {
  const firstCancellation = await request(app)
    .patch(`/api/bookings/${primaryBookingId}/cancel`)
    .set(authorization(firstToken))
    .expect(200);
  assert.equal(firstCancellation.body.meta.alreadyCancelled, false);
  assert.equal(firstCancellation.body.data.booking.status, "CANCELLED");
  assert.deepEqual(firstCancellation.body.data.booking.pricing, {
    unitAmount: "325.00",
    totalAmount: "650.00",
    currency: "USD",
  });
  assert.equal((await Flight.findById(primaryFlight._id)).availableSeats, 9);

  const repeatedCancellation = await request(app)
    .patch(`/api/bookings/${primaryBookingId}/cancel`)
    .set(authorization(firstToken))
    .expect(200);
  assert.equal(repeatedCancellation.body.meta.alreadyCancelled, true);
  assert.deepEqual(
    repeatedCancellation.body.data.booking.pricing,
    firstCancellation.body.data.booking.pricing,
  );
  assert.equal((await Flight.findById(primaryFlight._id)).availableSeats, 9);

  const replayAfterCancellation = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(
      bookingRequest(primaryFlight._id, primaryIdempotencyKey, {
        seatCount: 2,
        source: "AI",
      }),
    )
    .expect(200);
  assert.equal(replayAfterCancellation.body.data.booking.status, "CANCELLED");
  assert.equal(replayAfterCancellation.body.data.booking.id, primaryBookingId);
  assert.deepEqual(
    replayAfterCancellation.body.data.booking.pricing,
    firstCancellation.body.data.booking.pricing,
  );
  assert.equal((await Flight.findById(primaryFlight._id)).availableSeats, 9);

  const concurrentFlight = await createFlight({ totalSeats: 4 });
  const created = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(bookingRequest(concurrentFlight._id, randomUUID(), { seatCount: 2 }))
    .expect(201);
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      request(app)
        .patch(`/api/bookings/${created.body.data.booking.id}/cancel`)
        .set(authorization(firstToken)),
    ),
  );
  assert.ok(responses.every(({ status }) => status === 200));
  assert.equal(
    responses.filter(({ body }) => body.meta.alreadyCancelled === false).length,
    1,
  );
  assert.equal((await Flight.findById(concurrentFlight._id)).availableSeats, 4);
});

test("cancellation enforces ownership, valid IDs, and flight eligibility", async () => {
  const forbidden = await request(app)
    .patch(`/api/bookings/${secondUserBookingId}/cancel`)
    .set(authorization(firstToken))
    .expect(404);
  assert.equal(forbidden.body.error.code, "BOOKING_NOT_FOUND");

  const missing = await request(app)
    .patch(`/api/bookings/${new mongoose.Types.ObjectId()}/cancel`)
    .set(authorization(firstToken))
    .expect(404);
  assert.equal(missing.body.error.code, "BOOKING_NOT_FOUND");

  const invalid = await request(app)
    .patch("/api/bookings/not-an-object-id/cancel")
    .set(authorization(firstToken))
    .expect(400);
  assert.equal(invalid.body.error.code, "INVALID_REQUEST");

  const pastFlight = await createFlight({
    totalSeats: 2,
    availableSeats: 1,
    departureAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    status: "DEPARTED",
  });
  const pastBooking = await Booking.create(
    directBookingData({ user: firstUser, flight: pastFlight }),
  );
  const notCancellable = await request(app)
    .patch(`/api/bookings/${pastBooking._id}/cancel`)
    .set(authorization(firstToken))
    .expect(409);
  assert.equal(notCancellable.body.error.code, "BOOKING_NOT_CANCELLABLE");
  assert.equal((await Flight.findById(pastFlight._id)).availableSeats, 1);
});

test("a failed seat restoration rolls the booking back without adding seats", async () => {
  const flight = await createFlight({ totalSeats: 2 });
  const created = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(bookingRequest(flight._id))
    .expect(201);
  const originalFlightUpdate = Flight.updateOne;
  Flight.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });

  try {
    const response = await request(app)
      .patch(`/api/bookings/${created.body.data.booking.id}/cancel`)
      .set(authorization(firstToken))
      .expect(500);
    assert.equal(response.body.error.code, "BOOKING_CONSISTENCY_ERROR");
  } finally {
    Flight.updateOne = originalFlightUpdate;
  }

  const [booking, storedFlight] = await Promise.all([
    Booking.findById(created.body.data.booking.id),
    Flight.findById(flight._id),
  ]);
  assert.equal(booking.status, "CONFIRMED");
  assert.equal(booking.cancelledAt, null);
  assert.equal(storedFlight.availableSeats, 1);
});

test("an ambiguous cancellation transition never attempts to restore seats", async () => {
  const flight = await createFlight({ totalSeats: 2 });
  const created = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(bookingRequest(flight._id))
    .expect(201);
  const originalTransition = Booking.findOneAndUpdate;
  Booking.findOneAndUpdate = async (...args) => {
    await originalTransition.apply(Booking, args);
    throw new Error("injected unknown transition result");
  };

  try {
    const response = await request(app)
      .patch(`/api/bookings/${created.body.data.booking.id}/cancel`)
      .set(authorization(firstToken))
      .expect(500);
    assert.equal(response.body.error.code, "BOOKING_CONSISTENCY_ERROR");
  } finally {
    Booking.findOneAndUpdate = originalTransition;
  }

  const [booking, storedFlight] = await Promise.all([
    Booking.findById(created.body.data.booking.id),
    Flight.findById(flight._id),
  ]);
  assert.equal(booking.status, "CANCELLED");
  assert.equal(storedFlight.availableSeats, 1);
  await Flight.updateOne(
    { _id: flight._id, availableSeats: 1 },
    { $set: { availableSeats: 2 } },
  );
});

test("an unrecoverable cancellation failure is reported for reconciliation", async () => {
  const flight = await createFlight({ totalSeats: 2 });
  const created = await request(app)
    .post("/api/bookings")
    .set(authorization(firstToken))
    .send(bookingRequest(flight._id))
    .expect(201);
  const originalFlightUpdate = Flight.updateOne;
  const originalBookingUpdate = Booking.updateOne;
  Flight.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });
  Booking.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });

  try {
    const response = await request(app)
      .patch(`/api/bookings/${created.body.data.booking.id}/cancel`)
      .set(authorization(firstToken))
      .expect(500);
    assert.equal(response.body.error.code, "BOOKING_CONSISTENCY_ERROR");
  } finally {
    Flight.updateOne = originalFlightUpdate;
    Booking.updateOne = originalBookingUpdate;
  }

  const storedBooking = await Booking.findById(created.body.data.booking.id);
  assert.equal(storedBooking.status, "CANCELLED");
  assert.equal((await Flight.findById(flight._id)).availableSeats, 1);
  await Flight.updateOne(
    { _id: flight._id, availableSeats: 1 },
    { $set: { availableSeats: 2 } },
  );
});

test("/me isolates users, uses stable pagination, and returns only the DTO", async () => {
  const tieCandidates = await Booking.find({ user: firstUser._id })
    .sort({ _id: -1 })
    .limit(2)
    .select("_id")
    .lean();
  assert.equal(tieCandidates.length, 2);
  await Booking.collection.updateMany(
    { _id: { $in: tieCandidates.map(({ _id }) => _id) } },
    { $set: { createdAt: new Date("2026-08-07T12:00:00.000Z") } },
  );

  const expected = await Booking.find({ user: firstUser._id })
    .sort({ user: 1, createdAt: -1, _id: -1 })
    .select("_id")
    .lean();
  const pageSize = 3;
  const collectedIds = [];
  for (let page = 1; page <= Math.ceil(expected.length / pageSize); page += 1) {
    const response = await request(app)
      .get("/api/bookings/me")
      .query({ page, limit: pageSize })
      .set(authorization(firstToken))
      .expect(200);
    assert.equal(response.body.data.pagination.page, page);
    assert.equal(response.body.data.pagination.limit, pageSize);
    assert.equal(response.body.data.pagination.totalItems, expected.length);
    collectedIds.push(
      ...response.body.data.bookings.map((booking) => booking.id),
    );

    for (const booking of response.body.data.bookings) {
      assert.deepEqual(Object.keys(booking).sort(), [
        "bookingReference",
        "cancelledAt",
        "createdAt",
        "flight",
        "id",
        "pricing",
        "seatCount",
        "source",
        "status",
        "updatedAt",
      ]);
      assert.ok(booking.flight);
    }
  }
  assert.deepEqual(
    collectedIds,
    expected.map(({ _id }) => _id.toString()),
  );

  const secondUserResponse = await request(app)
    .get("/api/bookings/me")
    .set(authorization(secondToken))
    .expect(200);
  assert.ok(
    secondUserResponse.body.data.bookings.every(
      ({ id }) => id === secondUserBookingId,
    ),
  );
});

test("Booking indexes are user-scoped and support stable pagination", async () => {
  const indexes = await Booking.collection.indexes();
  const idempotencyIndex = indexes.find(
    ({ name }) => name === "user_1_idempotencyKey_1",
  );
  assert.ok(idempotencyIndex);
  assert.equal(idempotencyIndex.unique, true);
  assert.deepEqual(idempotencyIndex.key, { user: 1, idempotencyKey: 1 });
  assert.equal(indexes.some(({ name }) => name === "idempotencyKey_1"), false);
  assert.equal(
    indexes.some(({ name }) => name === "user_1_createdAt_-1"),
    false,
  );

  const paginationIndex = indexes.find(
    ({ name }) => name === "user_1_createdAt_-1__id_-1",
  );
  assert.ok(paginationIndex);
  assert.deepEqual(paginationIndex.key, { user: 1, createdAt: -1, _id: -1 });
});
