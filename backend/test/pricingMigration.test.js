import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KNOWN_FLIGHT_PRICES,
  PricingMigrationError,
  isValidPriceCents,
  isValidPriceSnapshot,
  migratePricing,
} from "../src/scripts/migratePricing.js";

function fakeModel(initialDocuments) {
  const documents = structuredClone(initialDocuments);
  return {
    documents,
    find() {
      return {
        lean: async () => structuredClone(documents),
      };
    },
    async updateOne(filter, update) {
      const document = documents.find(
        ({ _id }) => _id.toString() === filter._id.toString(),
      );
      if (!document) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      Object.assign(document, structuredClone(update.$set));
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

test("the migration contains the six explicit seed-flight price mappings", () => {
  assert.deepEqual(
    KNOWN_FLIGHT_PRICES.map(({ flightNumber, departureAt, priceCents }) => ({
      flightNumber,
      departureAt,
      priceCents,
    })),
    [
      {
        flightNumber: "CX101",
        departureAt: "2026-12-08T01:00:00.000Z",
        priceCents: 38000,
      },
      {
        flightNumber: "CA115",
        departureAt: "2026-12-08T02:30:00.000Z",
        priceCents: 32500,
      },
      {
        flightNumber: "HX313",
        departureAt: "2026-12-08T04:00:00.000Z",
        priceCents: 29000,
      },
      {
        flightNumber: "CX102",
        departureAt: "2026-12-12T01:15:00.000Z",
        priceCents: 36500,
      },
      {
        flightNumber: "CA116",
        departureAt: "2026-12-12T03:20:00.000Z",
        priceCents: 31000,
      },
      {
        flightNumber: "CX368",
        departureAt: "2026-12-10T00:50:00.000Z",
        priceCents: 24000,
      },
    ],
  );
});

test("price and snapshot validation accepts only positive safe integer cents and internally consistent USD snapshots", () => {
  for (const value of [1, 38000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isValidPriceCents(value), true);
  }
  for (const value of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isValidPriceCents(value), false);
  }

  assert.equal(
    isValidPriceSnapshot(
      { unitPriceCents: 38005, totalPriceCents: 76010, currency: "USD" },
      2,
    ),
    true,
  );
  assert.equal(
    isValidPriceSnapshot(
      { unitPriceCents: 38005, totalPriceCents: 76011, currency: "USD" },
      2,
    ),
    false,
  );
  assert.equal(
    isValidPriceSnapshot(
      { unitPriceCents: 38005, totalPriceCents: 76010, currency: "HKD" },
      2,
    ),
    false,
  );
});

test("report-only mode plans repairs without changing Flight or Booking documents", async () => {
  const FlightModel = fakeModel([
    {
      _id: "flight-cx101",
      flightNumber: "cx101",
      departureAt: new Date("2026-12-08T01:00:00.000Z"),
    },
  ]);
  const BookingModel = fakeModel([
    {
      _id: "booking-1",
      flight: "flight-cx101",
      seatCount: 2,
    },
  ]);

  const report = await migratePricing({ FlightModel, BookingModel });

  assert.equal(report.mode, "REPORT_ONLY");
  assert.equal(report.issues.invalidFlightPriceCount, 1);
  assert.equal(report.issues.invalidBookingSnapshotCount, 1);
  assert.equal(report.plannedRepairs.flights[0].priceCents, 38000);
  assert.deepEqual(report.plannedRepairs.bookings[0].priceSnapshot, {
    unitPriceCents: 38000,
    totalPriceCents: 76000,
    currency: "USD",
  });
  assert.equal(FlightModel.documents[0].priceCents, undefined);
  assert.equal(BookingModel.documents[0].priceSnapshot, undefined);
  assert.equal(report.finalVerification, null);
});

test("apply requires Booking writes to be paused", async () => {
  await assert.rejects(
    migratePricing({
      FlightModel: fakeModel([]),
      BookingModel: fakeModel([]),
      apply: true,
      bookingWritesPaused: false,
    }),
    (error) => {
      assert.ok(error instanceof PricingMigrationError);
      assert.match(error.message, /BOOKING_WRITES_PAUSED=true/);
      return true;
    },
  );
});

test("apply fills invalid values, preserves valid historical snapshots, verifies the result, and is idempotent", async () => {
  const FlightModel = fakeModel([
    {
      _id: "flight-cx101",
      flightNumber: "CX101",
      departureAt: new Date("2026-12-08T01:00:00.000Z"),
      priceCents: 0,
    },
    {
      _id: "flight-existing-price",
      flightNumber: "ZZ100",
      departureAt: new Date("2027-01-01T00:00:00.000Z"),
      priceCents: 45000,
    },
  ]);
  const validHistoricalSnapshot = {
    unitPriceCents: 40000,
    totalPriceCents: 80000,
    currency: "USD",
  };
  const BookingModel = fakeModel([
    {
      _id: "booking-missing",
      flight: "flight-cx101",
      seatCount: 2,
    },
    {
      _id: "booking-invalid",
      flight: "flight-existing-price",
      seatCount: 3,
      priceSnapshot: {
        unitPriceCents: 1.5,
        totalPriceCents: 4.5,
        currency: "USD",
      },
    },
    {
      _id: "booking-valid-history",
      flight: "flight-existing-price",
      seatCount: 2,
      priceSnapshot: validHistoricalSnapshot,
    },
  ]);

  const firstReport = await migratePricing({
    FlightModel,
    BookingModel,
    apply: true,
    bookingWritesPaused: true,
  });

  assert.equal(FlightModel.documents[0].priceCents, 38000);
  assert.deepEqual(BookingModel.documents[0].priceSnapshot, {
    unitPriceCents: 38000,
    totalPriceCents: 76000,
    currency: "USD",
  });
  assert.deepEqual(BookingModel.documents[1].priceSnapshot, {
    unitPriceCents: 45000,
    totalPriceCents: 135000,
    currency: "USD",
  });
  assert.deepEqual(
    BookingModel.documents[2].priceSnapshot,
    validHistoricalSnapshot,
  );
  assert.deepEqual(firstReport.finalVerification, {
    invalidFlightPriceCount: 0,
    invalidBookingSnapshotCount: 0,
  });

  const stateAfterFirstRun = structuredClone({
    flights: FlightModel.documents,
    bookings: BookingModel.documents,
  });
  const secondReport = await migratePricing({
    FlightModel,
    BookingModel,
    apply: true,
    bookingWritesPaused: true,
  });

  assert.deepEqual(
    { flights: FlightModel.documents, bookings: BookingModel.documents },
    stateAfterFirstRun,
  );
  assert.equal(secondReport.plannedRepairs.flights.length, 0);
  assert.equal(secondReport.plannedRepairs.bookings.length, 0);
  assert.deepEqual(secondReport.finalVerification, {
    invalidFlightPriceCount: 0,
    invalidBookingSnapshotCount: 0,
  });
});

test("an unknown flight with an invalid price is reported and prevents every write", async () => {
  const FlightModel = fakeModel([
    {
      _id: "unknown-flight",
      flightNumber: "ZZ999",
      departureAt: new Date("2027-01-01T00:00:00.000Z"),
    },
  ]);
  const BookingModel = fakeModel([]);

  await assert.rejects(
    migratePricing({
      FlightModel,
      BookingModel,
      apply: true,
      bookingWritesPaused: true,
    }),
    (error) => {
      assert.ok(error instanceof PricingMigrationError);
      assert.equal(error.report.unresolved.flights.length, 1);
      assert.equal(error.report.unresolved.flights[0].flightNumber, "ZZ999");
      return true;
    },
  );
  assert.equal(FlightModel.documents[0].priceCents, undefined);
});

test("orphaned bookings are reported and prevent writes", async () => {
  const FlightModel = fakeModel([]);
  const BookingModel = fakeModel([
    {
      _id: "orphaned-booking",
      flight: "missing-flight",
      seatCount: 1,
    },
  ]);

  await assert.rejects(
    migratePricing({
      FlightModel,
      BookingModel,
      apply: true,
      bookingWritesPaused: true,
    }),
    (error) => {
      assert.ok(error instanceof PricingMigrationError);
      assert.equal(error.report.unresolved.bookings.length, 1);
      assert.equal(
        error.report.unresolved.bookings[0].reason,
        "FLIGHT_NOT_FOUND",
      );
      return true;
    },
  );
  assert.equal(BookingModel.documents[0].priceSnapshot, undefined);
});
