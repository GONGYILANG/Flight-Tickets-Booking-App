import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import "dotenv/config";
import request from "supertest";

process.env.NODE_ENV = "test";

const [{ default: app }, databaseModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/database.js"),
]);

const { connectDatabase, disconnectDatabase } = databaseModule;

before(async () => {
  await connectDatabase();
});

after(async () => {
  await disconnectDatabase();
});

test("flight search validates required and malformed parameters", async () => {
  const missingResponse = await request(app)
    .get("/api/flights/search")
    .expect(400);

  assert.equal(missingResponse.body.error.code, "INVALID_REQUEST");
  assert.deepEqual(
    missingResponse.body.error.details.fields.map(({ field }) => field),
    ["origin", "destination", "departureDate"],
  );

  const invalidResponse = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "HKG",
      destination: "HKG",
      departureDate: "2026-02-30",
      passengers: 0,
      page: "one",
      limit: 100,
      sortBy: "price",
      sortOrder: "sideways",
    })
    .expect(400);

  const invalidFields = invalidResponse.body.error.details.fields.map(
    ({ field }) => field,
  );
  for (const field of [
    "departureDate",
    "passengers",
    "page",
    "limit",
    "sortBy",
    "sortOrder",
    "destination",
  ]) {
    assert.ok(invalidFields.includes(field));
  }
});

test("flight search returns populated direct flights for a UTC departure date", async () => {
  const response = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "pek",
      destination: "hkg",
      departureDate: "2026-12-08",
    })
    .expect(200);

  const { flights, pagination, search } = response.body.data;

  assert.equal(search.origin, "PEK");
  assert.equal(search.destination, "HKG");
  assert.equal(search.passengers, 1);
  assert.equal(search.sortBy, "departureAt");
  assert.equal(search.sortOrder, "asc");
  assert.ok(flights.length >= 2);
  assert.ok(pagination.totalItems >= flights.length);
  assert.equal(pagination.page, 1);
  assert.equal(pagination.limit, 20);

  const flightNumbers = flights.map(({ flightNumber }) => flightNumber);
  assert.ok(flightNumbers.includes("CX101"));
  assert.ok(flightNumbers.includes("CA115"));

  for (const flight of flights) {
    assert.equal(flight.originAirport.iataCode, "PEK");
    assert.equal(flight.destinationAirport.iataCode, "HKG");
    assert.ok(["SCHEDULED", "DELAYED"].includes(flight.status));
    assert.ok(flight.availableSeats >= 1);
    assert.equal(typeof flight.airline.code, "string");
    assert.ok(flight.durationMinutes > 0);
    assert.equal(flight.departureAt.slice(0, 10), "2026-12-08");
  }

  const departureTimes = flights.map(({ departureAt }) => departureAt);
  assert.deepEqual(departureTimes, [...departureTimes].sort());
});

test("flight search supports passenger filtering, sorting, and pagination", async () => {
  const response = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PEK",
      destination: "HKG",
      departureDate: "2026-12-08",
      passengers: 2,
      sortBy: "departureAt",
      sortOrder: "desc",
      page: 1,
      limit: 1,
    })
    .expect(200);

  const { flights, pagination, search } = response.body.data;
  assert.equal(flights.length, 1);
  assert.ok(flights[0].availableSeats >= 2);
  assert.equal(search.passengers, 2);
  assert.equal(search.sortOrder, "desc");
  assert.equal(pagination.limit, 1);
  assert.ok(pagination.totalPages >= 1);
});

test("flight search returns an empty result for an unknown route", async () => {
  const response = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "SIN",
      destination: "HKG",
      departureDate: "2026-12-08",
    })
    .expect(200);

  assert.deepEqual(response.body.data.flights, []);
  assert.equal(response.body.data.pagination.totalItems, 0);
  assert.equal(response.body.data.pagination.totalPages, 0);
});

test("flight detail returns a populated flight", async () => {
  const searchResponse = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PEK",
      destination: "HKG",
      departureDate: "2026-12-08",
      limit: 1,
    })
    .expect(200);

  const flightId = searchResponse.body.data.flights[0].id;
  const response = await request(app)
    .get(`/api/flights/${flightId}`)
    .expect(200);

  assert.equal(response.body.data.flight.id, flightId);
  assert.equal(response.body.data.flight.originAirport.iataCode, "PEK");
  assert.equal(response.body.data.flight.destinationAirport.iataCode, "HKG");
  assert.equal(typeof response.body.data.flight.airline.name, "string");
});

test("flight detail distinguishes invalid and missing flight IDs", async () => {
  const invalidResponse = await request(app)
    .get("/api/flights/not-an-object-id")
    .expect(400);
  assert.equal(invalidResponse.body.error.code, "INVALID_REQUEST");

  const missingResponse = await request(app)
    .get("/api/flights/000000000000000000000000")
    .expect(404);
  assert.equal(missingResponse.body.error.code, "FLIGHT_NOT_FOUND");
});
