import assert from "node:assert/strict";
import "../src/scripts/testDatabase.js";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import "dotenv/config";
import { DateTime } from "luxon";
import mongoose from "mongoose";
import request from "supertest";
import {
  formatUsdAmount,
  getDepartureWindow,
} from "../src/services/flightService.js";
import Flight from "../src/models/Flight.js";

const [{ default: app }, databaseModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/database.js"),
]);

const { connectDatabase, disconnectDatabase } = databaseModule;

before(async () => {
  await connectDatabase();
  await Flight.init();
});

after(async () => {
  await disconnectDatabase();
});

function validFlightData(overrides = {}) {
  const departureAt = new Date("2099-01-15T01:00:00.000Z");

  return {
    airline: new mongoose.Types.ObjectId(),
    flightNumber: `VT${randomUUID().replaceAll("-", "").slice(0, 8)}`,
    originAirport: new mongoose.Types.ObjectId(),
    destinationAirport: new mongoose.Types.ObjectId(),
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 3 * 60 * 60 * 1000),
    priceCents: 38000,
    totalSeats: 100,
    availableSeats: 100,
    status: "SCHEDULED",
    ...overrides,
  };
}

test("flight price requires a positive safe integer number of cents", async () => {
  for (const priceCents of [
    undefined,
    0,
    -1,
    38000.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const flight = new Flight(validFlightData({ priceCents }));

    await assert.rejects(
      () => flight.validate(),
      (error) => Boolean(error.errors?.priceCents),
    );
  }

  await assert.doesNotReject(() =>
    new Flight(validFlightData({ priceCents: 1 })).validate(),
  );

  assert.ok(
    Flight.schema
      .indexes()
      .some(
        ([fields]) => fields.priceCents === 1 && fields._id === 1,
      ),
    "Flight schema must declare the stable price sorting index",
  );
});

test("flight prices format USD cents as fixed two-decimal strings", () => {
  assert.equal(formatUsdAmount(38000), "380.00");
  assert.equal(formatUsdAmount(38005), "380.05");
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
      sortBy: "durationMinutes",
      sortOrder: "sideways",
      departurePeriod: "dawn",
      airlineCode: "!",
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
    "departurePeriod",
    "airlineCode",
    "destination",
  ]) {
    assert.ok(invalidFields.includes(field));
  }
});

test("flight search returns populated direct flights for the origin-local date", async () => {
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
  assert.equal(search.departurePeriod, null);
  assert.equal(search.airlineCode, null);
  assert.equal(search.departureTimezone, "Asia/Shanghai");
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
    assert.equal(flight.price.currency, "USD");
    assert.match(flight.price.amount, /^\d+\.\d{2}$/);
    assert.equal("priceCents" in flight, false);
    assert.equal(
      DateTime.fromISO(flight.departureAt)
        .setZone(flight.originAirport.timezone)
        .toISODate(),
      "2026-12-08",
    );
  }

  const departureTimes = flights.map(({ departureAt }) => departureAt);
  assert.deepEqual(departureTimes, [...departureTimes].sort());

  const flightsByNumber = new Map(
    flights.map((flight) => [flight.flightNumber, flight]),
  );
  assert.deepEqual(flightsByNumber.get("CX101").price, {
    amount: "380.00",
    currency: "USD",
  });
  assert.deepEqual(flightsByNumber.get("CA115").price, {
    amount: "325.00",
    currency: "USD",
  });
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

test("flight search supports every advertised database sort", async () => {
  for (const sortBy of [
    "departureAt",
    "arrivalAt",
    "availableSeats",
    "price",
  ]) {
    for (const sortOrder of ["asc", "desc"]) {
      const response = await request(app)
        .get("/api/flights/search")
        .query({
          origin: "PEK",
          destination: "HKG",
          departureDate: "2026-12-08",
          sortBy,
          sortOrder,
        })
        .expect(200);

      const values = response.body.data.flights.map((flight) => {
        if (["departureAt", "arrivalAt"].includes(sortBy)) {
          return new Date(flight[sortBy]).getTime();
        }
        if (sortBy === "price") {
          return Number(flight.price.amount);
        }
        return flight[sortBy];
      });
      const direction = sortOrder === "asc" ? 1 : -1;
      assert.deepEqual(
        values,
        [...values].sort((first, second) => (first - second) * direction),
      );
      assert.equal(response.body.data.search.sortBy, sortBy);
      assert.equal(response.body.data.search.sortOrder, sortOrder);
    }
  }
});

test("price sorting uses _id as a stable pagination tie-breaker", async () => {
  const template = await Flight.findOne({ flightNumber: "CX101" }).lean();
  assert.ok(template, "CX101 seed flight is required for this test");

  const firstDeparture = new Date("2099-01-15T01:00:00.000Z");
  const secondDeparture = new Date("2099-01-15T02:00:00.000Z");
  const createdFlights = await Flight.create([
    {
      ...validFlightData({
        airline: template.airline,
        originAirport: template.originAirport,
        destinationAirport: template.destinationAirport,
        departureAt: firstDeparture,
        arrivalAt: new Date(firstDeparture.getTime() + 3 * 60 * 60 * 1000),
        priceCents: 41000,
      }),
    },
    {
      ...validFlightData({
        airline: template.airline,
        originAirport: template.originAirport,
        destinationAirport: template.destinationAirport,
        departureAt: secondDeparture,
        arrivalAt: new Date(secondDeparture.getTime() + 3 * 60 * 60 * 1000),
        priceCents: 41000,
      }),
    },
  ]);
  const createdIds = createdFlights.map(({ _id }) => _id);

  try {
    const pageIds = [];
    for (const page of [1, 2]) {
      const response = await request(app)
        .get("/api/flights/search")
        .query({
          origin: "PEK",
          destination: "HKG",
          departureDate: "2099-01-15",
          sortBy: "price",
          sortOrder: "asc",
          page,
          limit: 1,
        })
        .expect(200);

      assert.equal(response.body.data.flights.length, 1);
      pageIds.push(response.body.data.flights[0].id);
    }

    const expectedIds = createdFlights
      .map(({ _id }) => _id.toString())
      .sort();
    assert.deepEqual(pageIds, expectedIds);
    assert.equal(new Set(pageIds).size, 2);
  } finally {
    await Flight.deleteMany({ _id: { $in: createdIds } });
  }
});

test("flight search interprets the date and periods in the origin timezone", async () => {
  const windowReferenceTime = new Date("2026-01-01T00:00:00.000Z");
  const fullDay = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: null },
    "Asia/Shanghai",
    windowReferenceTime,
  );
  assert.equal(fullDay.start.toISOString(), "2026-12-07T16:00:00.000Z");
  assert.equal(fullDay.end.toISOString(), "2026-12-08T16:00:00.000Z");

  const morning = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: "MORNING" },
    "Asia/Shanghai",
    windowReferenceTime,
  );
  const afternoon = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: "AFTERNOON" },
    "Asia/Shanghai",
    windowReferenceTime,
  );
  const elevenFiftyNine = new Date("2026-12-08T03:59:00.000Z");
  const noon = new Date("2026-12-08T04:00:00.000Z");

  assert.ok(elevenFiftyNine >= morning.start && elevenFiftyNine < morning.end);
  assert.ok(!(noon >= morning.start && noon < morning.end));
  assert.ok(noon >= afternoon.start && noon < afternoon.end);

  const daylightSavingDay = getDepartureWindow(
    { departureDate: "2026-03-08", departurePeriod: null },
    "America/New_York",
    windowReferenceTime,
  );
  assert.equal(
    daylightSavingDay.end.getTime() - daylightSavingDay.start.getTime(),
    23 * 60 * 60 * 1000,
  );
  const daylightSavingFallBackDay = getDepartureWindow(
    { departureDate: "2026-11-01", departurePeriod: null },
    "America/New_York",
    windowReferenceTime,
  );
  assert.equal(
    daylightSavingFallBackDay.end.getTime() -
      daylightSavingFallBackDay.start.getTime(),
    25 * 60 * 60 * 1000,
  );
  for (const invalidTimezone of [undefined, null, "Not/A_Timezone"]) {
    assert.throws(
      () =>
        getDepartureWindow(
          { departureDate: "2026-12-08", departurePeriod: null },
          invalidTimezone,
          windowReferenceTime,
        ),
      (error) => error.code === "INVALID_AIRPORT_TIMEZONE",
    );
  }

  const inProgressDay = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: null },
    "Asia/Shanghai",
    new Date("2026-12-08T02:00:00.000Z"),
  );
  assert.equal(inProgressDay.start.toISOString(), "2026-12-08T02:00:00.000Z");
  assert.equal(inProgressDay.end.toISOString(), "2026-12-08T16:00:00.000Z");

  const expiredMorning = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: "MORNING" },
    "Asia/Shanghai",
    new Date("2026-12-08T04:00:00.000Z"),
  );
  assert.equal(expiredMorning.start.getTime(), expiredMorning.end.getTime());

  const morningResponse = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PKX",
      destination: "HKG",
      departureDate: "2026-12-08",
      departurePeriod: "MORNING",
    })
    .expect(200);
  assert.deepEqual(morningResponse.body.data.flights, []);

  const afternoonResponse = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PKX",
      destination: "HKG",
      departureDate: "2026-12-08",
      departurePeriod: "afternoon",
    })
    .expect(200);
  assert.deepEqual(
    afternoonResponse.body.data.flights.map(({ flightNumber }) => flightNumber),
    ["HX313"],
  );
  assert.equal(afternoonResponse.body.data.search.departurePeriod, "AFTERNOON");
});

test("flight search supports airline filtering", async () => {
  const response = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PEK",
      destination: "HKG",
      departureDate: "2026-12-08",
      airlineCode: "cx",
    })
    .expect(200);

  assert.deepEqual(
    response.body.data.flights.map(({ flightNumber }) => flightNumber),
    ["CX101"],
  );
  assert.equal(response.body.data.search.airlineCode, "CX");

  const unknownResponse = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PEK",
      destination: "HKG",
      departureDate: "2026-12-08",
      airlineCode: "ZZ",
    })
    .expect(400);
  assert.deepEqual(
    unknownResponse.body.error.details.fields.map(({ field }) => field),
    ["airlineCode"],
  );
});

test("flight search returns an empty result for a valid route without flights", async () => {
  const response = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "PVG",
      destination: "HKG",
      departureDate: "2026-12-08",
    })
    .expect(200);

  assert.deepEqual(response.body.data.flights, []);
  assert.equal(response.body.data.pagination.totalItems, 0);
  assert.equal(response.body.data.pagination.totalPages, 0);
});

test("flight search rejects an unknown airport", async () => {
  const response = await request(app)
    .get("/api/flights/search")
    .query({
      origin: "SIN",
      destination: "HKG",
      departureDate: "2026-12-08",
    })
    .expect(400);

  assert.equal(response.body.error.code, "INVALID_REQUEST");
  assert.deepEqual(
    response.body.error.details.fields.map(({ field }) => field),
    ["origin"],
  );
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
  assert.equal(response.body.data.flight.price.currency, "USD");
  assert.match(response.body.data.flight.price.amount, /^\d+\.\d{2}$/);
  assert.equal("priceCents" in response.body.data.flight, false);
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
