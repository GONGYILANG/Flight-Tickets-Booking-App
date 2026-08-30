import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import User from "../models/User.js";
import { formatUsdAmount, toFlightResponse } from "./flightService.js";

const bookableStatuses = ["SCHEDULED", "DELAYED"];
const idempotencyReadAttempts = 8;
const bookingReferenceAttempts = 2;
const flightPopulate = [
  { path: "airline", select: "code name" },
  {
    path: "originAirport",
    select: "iataCode name cityName countryCode timezone",
  },
  {
    path: "destinationAirport",
    select: "iataCode name cityName countryCode timezone",
  },
];

function serviceError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireObjectId(value, fieldName) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw serviceError(
      "INVALID_ID",
      `${fieldName} is not a valid ObjectId`,
      400,
    );
  }
}

function assertBookingWritesEnabled() {
  if (process.env.BOOKING_WRITES_PAUSED === "true") {
    throw serviceError(
      "BOOKING_WRITES_PAUSED",
      "Booking writes are temporarily paused for maintenance",
      503,
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function toIsoString(value) {
  return value ? new Date(value).toISOString() : null;
}

function isValidPriceSnapshot(priceSnapshot, seatCount) {
  return (
    priceSnapshot?.currency === "USD" &&
    Number.isSafeInteger(priceSnapshot.unitPriceCents) &&
    priceSnapshot.unitPriceCents > 0 &&
    Number.isSafeInteger(priceSnapshot.totalPriceCents) &&
    priceSnapshot.totalPriceCents > 0 &&
    priceSnapshot.totalPriceCents ===
      priceSnapshot.unitPriceCents * seatCount
  );
}

function toPricingResponse(priceSnapshot, seatCount) {
  if (!isValidPriceSnapshot(priceSnapshot, seatCount)) {
    throw serviceError(
      "BOOKING_CONSISTENCY_ERROR",
      "Booking pricing data is missing or invalid",
      500,
    );
  }

  return {
    unitAmount: formatUsdAmount(priceSnapshot.unitPriceCents),
    totalAmount: formatUsdAmount(priceSnapshot.totalPriceCents),
    currency: priceSnapshot.currency,
  };
}

function createPriceSnapshot(flight, seatCount) {
  const unitPriceCents = flight.priceCents;
  const totalPriceCents = unitPriceCents * seatCount;
  const priceSnapshot = {
    unitPriceCents,
    totalPriceCents,
    currency: "USD",
  };

  return isValidPriceSnapshot(priceSnapshot, seatCount)
    ? priceSnapshot
    : null;
}

export function toBookingResponse(booking) {
  const populatedFlight =
    booking.flight && booking.flight.departureAt ? booking.flight : null;
  const cancellation =
    booking.status === "CANCELLED"
      ? {
          source: booking.cancellationSource ?? "USER",
          reason: booking.cancellationReason ?? null,
        }
      : null;

  return {
    id: booking._id.toString(),
    bookingReference: booking.bookingReference,
    flight: populatedFlight ? toFlightResponse(populatedFlight) : null,
    seatCount: booking.seatCount,
    pricing: toPricingResponse(booking.priceSnapshot, booking.seatCount),
    source: booking.source,
    status: booking.status,
    cancellation,
    createdAt: toIsoString(booking.createdAt),
    updatedAt: toIsoString(booking.updatedAt),
    cancelledAt: toIsoString(booking.cancelledAt),
  };
}

function normalizeCreateInput({
  userId,
  flightId,
  seatCount = 1,
  source = "UI",
  idempotencyKey,
}) {
  requireObjectId(userId, "userId");
  requireObjectId(flightId, "flightId");

  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 9) {
    throw serviceError(
      "INVALID_SEAT_COUNT",
      "seatCount must be an integer from 1 to 9",
      400,
    );
  }

  const normalizedSource =
    typeof source === "string" ? source.trim().toUpperCase() : source;
  if (!["UI", "AI"].includes(normalizedSource)) {
    throw serviceError("INVALID_SOURCE", "source must be UI or AI", 400);
  }

  const normalizedKey =
    typeof idempotencyKey === "string"
      ? idempotencyKey.trim().toLowerCase()
      : "";
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!uuidPattern.test(normalizedKey)) {
    throw serviceError(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be a canonical UUID",
      400,
    );
  }

  return {
    userId: userId.toString(),
    flightId: flightId.toString(),
    seatCount,
    source: normalizedSource,
    idempotencyKey: normalizedKey,
  };
}

function bookingMatchesRequest(booking, input) {
  return (
    booking.flight?.toString() === input.flightId &&
    booking.seatCount === input.seatCount &&
    booking.source === input.source
  );
}

function assertIdempotentRequestMatches(booking, input) {
  if (!bookingMatchesRequest(booking, input)) {
    throw serviceError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "The idempotency key was already used with a different request",
      409,
    );
  }
}

async function findExistingBooking(input, attempts = 1) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const existing = await Booking.findOne({
      user: input.userId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing || attempt === attempts) {
      return existing;
    }
    await delay(attempt * 20);
  }

  return null;
}

async function loadBookingResponse(bookingId) {
  const booking = await Booking.findById(bookingId)
    .populate({ path: "flight", populate: flightPopulate })
    .lean();

  if (!booking) {
    throw serviceError(
      "BOOKING_CONSISTENCY_ERROR",
      "Booking data could not be loaded",
      500,
    );
  }

  return toBookingResponse(booking);
}

async function replayResult(existing, input) {
  assertIdempotentRequestMatches(existing, input);
  return {
    booking: await loadBookingResponse(existing._id),
    idempotentReplay: true,
  };
}

function createBookingReference() {
  return `BK${randomUUID().replaceAll("-", "").slice(0, 12)}`.toUpperCase();
}

function logConsistencyFailure({ operation, bookingId, bookingReference, flightId }) {
  console.error("Booking consistency failure", {
    operation,
    bookingId: bookingId?.toString(),
    bookingReference,
    flightId: flightId?.toString(),
  });
}

function consistencyError(context) {
  logConsistencyFailure(context);
  return serviceError(
    "BOOKING_CONSISTENCY_ERROR",
    "Booking inventory is temporarily inconsistent and requires repair",
    500,
  );
}

async function compensateSeatDeduction({ flight, seatCount, bookingReference }) {
  try {
    const result = await Flight.updateOne(
      {
        _id: flight._id,
        availableSeats: { $lte: flight.totalSeats - seatCount },
      },
      { $inc: { availableSeats: seatCount } },
    );

    if (result.matchedCount !== 1) {
      throw new Error("Seat compensation did not match the flight");
    }
  } catch (_error) {
    throw consistencyError({
      operation: "CREATE_COMPENSATION",
      bookingReference,
      flightId: flight._id,
    });
  }
}

async function tryCreateBooking(input, referenceAttempt) {
  const now = new Date();
  const bookingReference = createBookingReference();
  const bookingId = new mongoose.Types.ObjectId();
  let flight;
  try {
    flight = await Flight.findOneAndUpdate(
      {
        _id: input.flightId,
        status: { $in: bookableStatuses },
        departureAt: { $gt: now },
        availableSeats: { $gte: input.seatCount },
      },
      { $inc: { availableSeats: -input.seatCount } },
      { returnDocument: "after" },
    );
  } catch (_error) {
    throw consistencyError({
      operation: "CREATE_DECREMENT_RESULT_UNKNOWN",
      bookingId,
      bookingReference,
      flightId: input.flightId,
    });
  }

  if (!flight) {
    const concurrentReplay = await findExistingBooking(
      input,
      idempotencyReadAttempts,
    );
    if (concurrentReplay) {
      return replayResult(concurrentReplay, input);
    }

    throw serviceError(
      "FLIGHT_NOT_FOUND_OR_SOLD_OUT",
      "Flight does not exist, has departed, is unavailable, or has insufficient seats",
      409,
    );
  }

  const priceSnapshot = createPriceSnapshot(flight, input.seatCount);
  if (!priceSnapshot) {
    await compensateSeatDeduction({
      flight,
      seatCount: input.seatCount,
      bookingReference,
    });
    console.error("Booking creation blocked by invalid flight pricing", {
      bookingReference,
      flightId: flight._id.toString(),
    });
    throw serviceError(
      "BOOKING_CREATION_FAILED",
      "Booking could not be created because flight pricing is unavailable; no seats were charged",
      500,
    );
  }

  let booking;
  try {
    booking = await Booking.create({
      _id: bookingId,
      bookingReference,
      user: input.userId,
      flight: input.flightId,
      seatCount: input.seatCount,
      source: input.source,
      status: "CONFIRMED",
      idempotencyKey: input.idempotencyKey,
      priceSnapshot,
    });
  } catch (insertError) {
    let insertedDespiteError;
    try {
      insertedDespiteError = await Booking.findById(bookingId);
    } catch (_lookupError) {
      throw consistencyError({
        operation: "CREATE_INSERT_RESULT_UNKNOWN",
        bookingId,
        bookingReference,
        flightId: flight._id,
      });
    }

    if (insertedDespiteError) {
      return {
        booking: await loadBookingResponse(insertedDespiteError._id),
        idempotentReplay: false,
      };
    }

    await compensateSeatDeduction({
      flight,
      seatCount: input.seatCount,
      bookingReference,
    });

    if (insertError?.code === 11000) {
      const winner = await findExistingBooking(
        input,
        idempotencyReadAttempts,
      );
      if (winner) {
        return replayResult(winner, input);
      }

      if (referenceAttempt < bookingReferenceAttempts) {
        return tryCreateBooking(input, referenceAttempt + 1);
      }
    }

    console.error("Booking insertion failed after seat compensation", {
      errorName: insertError?.name,
      errorCode: insertError?.code,
      bookingReference,
      flightId: flight._id.toString(),
    });
    throw serviceError(
      "BOOKING_CREATION_FAILED",
      "Booking could not be created; no seats were charged",
      500,
    );
  }

  return {
    booking: await loadBookingResponse(booking._id),
    idempotentReplay: false,
  };
}

export async function createBooking(input) {
  assertBookingWritesEnabled();
  const normalizedInput = normalizeCreateInput(input);
  const existing = await findExistingBooking(normalizedInput);
  if (existing) {
    return replayResult(existing, normalizedInput);
  }

  const userExists = await User.exists({
    _id: normalizedInput.userId,
    status: "ACTIVE",
  });
  if (!userExists) {
    throw serviceError("USER_NOT_FOUND", "Active user was not found", 404);
  }

  return tryCreateBooking(normalizedInput, 1);
}

function isBookableFlight(flight, now) {
  return (
    flight &&
    bookableStatuses.includes(flight.status) &&
    new Date(flight.departureAt) > now
  );
}

async function rollbackCancellation(booking, cancelledAt) {
  try {
    const result = await Booking.updateOne(
      {
        _id: booking._id,
        status: "CANCELLED",
        cancelledAt,
      },
      {
        $set: {
          status: "CONFIRMED",
          cancelledAt: null,
          cancellationSource: null,
          cancelledBy: null,
          cancellationReason: null,
        },
      },
    );
    return result.matchedCount === 1;
  } catch (_error) {
    return false;
  }
}

async function cancelledResult(booking, alreadyCancelled) {
  return {
    booking: await loadBookingResponse(booking._id),
    alreadyCancelled,
  };
}

export async function cancelBooking({ userId, bookingId }) {
  assertBookingWritesEnabled();
  requireObjectId(userId, "userId");
  requireObjectId(bookingId, "bookingId");

  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) {
    throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
  }
  if (booking.status === "CANCELLED") {
    return cancelledResult(booking, true);
  }

  const eligibilityTime = new Date();
  const flight = await Flight.findById(booking.flight).select(
    "status departureAt totalSeats availableSeats",
  );
  if (!flight) {
    throw consistencyError({
      operation: "CANCEL_FLIGHT_MISSING",
      bookingId: booking._id,
      flightId: booking.flight,
    });
  }
  if (!isBookableFlight(flight, eligibilityTime)) {
    throw serviceError(
      "BOOKING_NOT_CANCELLABLE",
      "Only bookings for upcoming scheduled or delayed flights can be cancelled",
      409,
    );
  }

  const cancelledAt = new Date();
  let transitioned;
  try {
    transitioned = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        user: userId,
        status: "CONFIRMED",
      },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt,
          cancellationSource: "USER",
          cancelledBy: userId,
          cancellationReason: null,
        },
      },
      { returnDocument: "after" },
    );
  } catch (_error) {
    // A timeout cannot prove whether this state change was applied. Never
    // restore inventory from an ambiguous transition; reconciliation can
    // safely derive the expected inventory from the final booking status.
    throw consistencyError({
      operation: "CANCEL_TRANSITION_RESULT_UNKNOWN",
      bookingId,
      flightId: booking.flight,
    });
  }

  if (!transitioned) {
    const concurrentResult = await Booking.findOne({
      _id: bookingId,
      user: userId,
    });
    if (!concurrentResult) {
      throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
    }
    if (concurrentResult.status === "CANCELLED") {
      return cancelledResult(concurrentResult, true);
    }
    throw serviceError(
      "BOOKING_NOT_CANCELLABLE",
      "Booking could not be cancelled in its current state",
      409,
    );
  }

  let restorationResult;
  try {
    restorationResult = await Flight.updateOne(
      {
        _id: flight._id,
        status: { $in: bookableStatuses },
        departureAt: { $gt: cancelledAt },
        availableSeats: {
          $lte: flight.totalSeats - transitioned.seatCount,
        },
      },
      { $inc: { availableSeats: transitioned.seatCount } },
    );
  } catch (_error) {
    throw consistencyError({
      operation: "CANCEL_RESTORE_RESULT_UNKNOWN",
      bookingId: transitioned._id,
      flightId: flight._id,
    });
  }

  if (restorationResult.matchedCount !== 1) {
    const rolledBack = await rollbackCancellation(transitioned, cancelledAt);
    if (!rolledBack) {
      throw consistencyError({
        operation: "CANCEL_RESTORE_AND_ROLLBACK_FAILED",
        bookingId: transitioned._id,
        flightId: flight._id,
      });
    }

    const currentFlight = await Flight.findById(flight._id).select(
      "status departureAt totalSeats availableSeats",
    );
    if (!currentFlight) {
      throw consistencyError({
        operation: "CANCEL_FLIGHT_DISAPPEARED",
        bookingId: transitioned._id,
        flightId: flight._id,
      });
    }
    if (!isBookableFlight(currentFlight, new Date())) {
      throw serviceError(
        "BOOKING_NOT_CANCELLABLE",
        "The flight is no longer eligible for cancellation",
        409,
      );
    }

    throw consistencyError({
      operation: "CANCEL_RESTORE_GUARD_FAILED",
      bookingId: transitioned._id,
      flightId: flight._id,
    });
  }

  return cancelledResult(transitioned, false);
}

export async function listBookingsForUser({ userId, page = 1, limit = 20 }) {
  requireObjectId(userId, "userId");

  const filter = { user: userId };
  const skip = (page - 1) * limit;
  const [bookings, totalItems] = await Promise.all([
    Booking.find(filter)
      // Cosmos DB for MongoDB requires the equality-filtered index prefix in
      // the multi-field ORDER BY. Since every row has the same user here,
      // this is equivalent to ordering by createdAt and _id alone.
      .sort({ user: 1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: "flight", populate: flightPopulate })
      .lean(),
    Booking.countDocuments(filter),
  ]);

  return {
    bookings: bookings.map(toBookingResponse),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
}
