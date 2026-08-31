import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import Booking from "../src/models/Booking.js";
import { getBookingForUser } from "../src/services/bookingService.js";

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

function bookingFixture({ userId, bookingId }) {
  const departureAt = new Date("2099-01-15T01:00:00.000Z");
  return {
    _id: bookingId,
    bookingReference: "BK1234567890AB",
    user: userId,
    flight: {
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
      scheduledDepartureAt: departureAt,
      scheduledArrivalAt: new Date(
        departureAt.getTime() + 4 * 60 * 60 * 1000,
      ),
      priceCents: 30000,
      totalSeats: 100,
      availableSeats: 80,
      status: "SCHEDULED",
    },
    seatCount: 1,
    priceSnapshot: {
      unitPriceCents: 30000,
      totalPriceCents: 30000,
      currency: "USD",
    },
    source: "UI",
    status: "CONFIRMED",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    cancelledAt: null,
  };
}

test("user booking detail applies ownership in the database query", async () => {
  const userId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const fixture = bookingFixture({ userId, bookingId });
  const originalFindOne = Booking.findOne;
  let receivedFilter;
  Booking.findOne = (filter) => {
    receivedFilter = filter;
    return populatedQuery(fixture);
  };

  try {
    const response = await getBookingForUser({ userId, bookingId });
    assert.deepEqual(receivedFilter, { _id: bookingId, user: userId });
    assert.equal(response.id, bookingId.toString());
    assert.equal(response.flight.scheduleChanged, false);
    assert.equal("idempotencyKey" in response, false);
  } finally {
    Booking.findOne = originalFindOne;
  }
});

test("user booking detail hides missing and non-owned records with one error", async () => {
  const originalFindOne = Booking.findOne;
  Booking.findOne = () => populatedQuery(null);
  try {
    await assert.rejects(
      getBookingForUser({
        userId: new mongoose.Types.ObjectId(),
        bookingId: new mongoose.Types.ObjectId(),
      }),
      ({ code, statusCode }) =>
        code === "BOOKING_NOT_FOUND" && statusCode === 404,
    );
  } finally {
    Booking.findOne = originalFindOne;
  }
});
