import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import Booking from "../src/models/Booking.js";
import Flight from "../src/models/Flight.js";
import { updateAdminFlight } from "../src/services/adminService.js";

function populatedFlight(overrides = {}) {
  const departureAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    _id: new mongoose.Types.ObjectId(),
    flightNumber: "UT100",
    airline: {
      _id: new mongoose.Types.ObjectId(),
      code: "UT",
      name: "Unit Test Airline",
    },
    originAirport: {
      _id: new mongoose.Types.ObjectId(),
      iataCode: "SIN",
      name: "Singapore Changi Airport",
      cityName: "Singapore",
      countryCode: "SG",
      timezone: "Asia/Singapore",
    },
    destinationAirport: {
      _id: new mongoose.Types.ObjectId(),
      iataCode: "HKG",
      name: "Hong Kong International Airport",
      cityName: "Hong Kong",
      countryCode: "HK",
      timezone: "Asia/Hong_Kong",
    },
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 4 * 60 * 60 * 1000),
    priceCents: 30000,
    totalSeats: 100,
    availableSeats: 80,
    status: "SCHEDULED",
    statusUpdatedAt: null,
    statusUpdatedBy: null,
    statusReason: null,
    ...overrides,
  };
}

function populatedQuery(document) {
  return {
    populate() {
      return this;
    },
    async lean() {
      return document;
    },
  };
}

test("admin flight price update changes only the current Flight price", async () => {
  const actorId = new mongoose.Types.ObjectId();
  let stored = populatedFlight();
  let findByIdCalls = 0;
  const originalFindById = Flight.findById;
  const originalFindOneAndUpdate = Flight.findOneAndUpdate;
  const originalBookingUpdateMany = Booking.updateMany;

  Flight.findById = () => {
    findByIdCalls += 1;
    return findByIdCalls === 1 ? Promise.resolve(stored) : populatedQuery(stored);
  };
  Flight.findOneAndUpdate = async (_filter, update) => {
    stored = { ...stored, ...update.$set };
    return stored;
  };
  Booking.updateMany = async () => {
    throw new Error("Price-only update must not touch bookings");
  };

  try {
    const result = await updateAdminFlight({
      actorId,
      flightId: stored._id,
      update: {
        hasStatus: false,
        hasPriceCents: true,
        status: null,
        priceCents: 45555,
        reason: null,
      },
    });
    assert.deepEqual(result.changedFields, ["priceCents"]);
    assert.equal(result.flight.priceCents, 45555);
    assert.equal(result.flight.price.amount, "455.55");
    assert.equal(result.affectedBookings, 0);
  } finally {
    Flight.findById = originalFindById;
    Flight.findOneAndUpdate = originalFindOneAndUpdate;
    Booking.updateMany = originalBookingUpdateMany;
  }
});

test("admin flight cancellation updates bookings and normalizes inventory", async () => {
  const actorId = new mongoose.Types.ObjectId();
  let stored = populatedFlight({ availableSeats: 70 });
  let findByIdCalls = 0;
  let bookingUpdate;
  const originalFindById = Flight.findById;
  const originalFindOneAndUpdate = Flight.findOneAndUpdate;
  const originalFlightUpdateOne = Flight.updateOne;
  const originalBookingUpdateMany = Booking.updateMany;

  Flight.findById = () => {
    findByIdCalls += 1;
    return findByIdCalls === 1 ? Promise.resolve(stored) : populatedQuery(stored);
  };
  Flight.findOneAndUpdate = async (_filter, update) => {
    stored = { ...stored, ...update.$set };
    return stored;
  };
  Booking.updateMany = async (filter, update) => {
    bookingUpdate = { filter, update };
    return { matchedCount: 2, modifiedCount: 2 };
  };
  Flight.updateOne = async (_filter, update) => {
    stored = { ...stored, ...update.$set };
    return { matchedCount: 1, modifiedCount: 1 };
  };

  try {
    const result = await updateAdminFlight({
      actorId,
      flightId: stored._id,
      update: {
        hasStatus: true,
        hasPriceCents: false,
        status: "CANCELLED",
        priceCents: null,
        reason: "Operational cancellation",
      },
    });
    assert.equal(result.flight.status, "CANCELLED");
    assert.equal(result.flight.availableSeats, 100);
    assert.equal(result.affectedBookings, 2);
    assert.equal(bookingUpdate.filter.status, "CONFIRMED");
    assert.equal(bookingUpdate.update.$set.cancellationSource, "FLIGHT");
    assert.equal(
      bookingUpdate.update.$set.cancellationReason,
      "Operational cancellation",
    );
  } finally {
    Flight.findById = originalFindById;
    Flight.findOneAndUpdate = originalFindOneAndUpdate;
    Flight.updateOne = originalFlightUpdateOne;
    Booking.updateMany = originalBookingUpdateMany;
  }
});

test("admin flight update rejects invalid terminal status transitions", async () => {
  const current = populatedFlight({ status: "ARRIVED" });
  const originalFindById = Flight.findById;
  Flight.findById = async () => current;
  try {
    await assert.rejects(
      updateAdminFlight({
        actorId: new mongoose.Types.ObjectId(),
        flightId: current._id,
        update: {
          hasStatus: true,
          hasPriceCents: false,
          status: "SCHEDULED",
          priceCents: null,
          reason: "Invalid recovery",
        },
      }),
      ({ code, statusCode }) =>
        code === "INVALID_STATUS_TRANSITION" && statusCode === 409,
    );
  } finally {
    Flight.findById = originalFindById;
  }
});
