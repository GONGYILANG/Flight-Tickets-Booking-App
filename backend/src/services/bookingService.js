import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { serviceError } from "../errors.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import User from "../models/User.js";
import {
  bookableFlightStatuses,
  flightPopulate,
  formatUsdAmount,
  toFlightResponse,
} from "./flightService.js";

function assertBookingWritesEnabled() {
  if (process.env.BOOKING_WRITES_PAUSED === "true") {
    throw serviceError(
      "BOOKING_WRITES_PAUSED",
      "Booking writes are temporarily paused for maintenance",
      503,
    );
  }
}

function toIsoString(value) {
  return value ? new Date(value).toISOString() : null;
}

function toPricingResponse(priceSnapshot) {
  return {
    unitAmount: formatUsdAmount(priceSnapshot.unitPriceCents),
    totalAmount: formatUsdAmount(priceSnapshot.totalPriceCents),
    currency: priceSnapshot.currency,
  };
}

function createPriceSnapshot(flight, seatCount) {
  const unitPriceCents = flight.priceCents;
  return {
    unitPriceCents,
    totalPriceCents: unitPriceCents * seatCount,
    currency: "USD",
  };
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
    pricing: toPricingResponse(booking.priceSnapshot),
    source: booking.source,
    status: booking.status,
    cancellation,
    createdAt: toIsoString(booking.createdAt),
    updatedAt: toIsoString(booking.updatedAt),
    cancelledAt: toIsoString(booking.cancelledAt),
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

async function findExistingBooking(input, session = null) {
  return Booking.findOne({
    user: input.userId,
    idempotencyKey: input.idempotencyKey,
  }).session(session);
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

const transactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
  timeoutMS: 10000,
};

async function runBookingTransaction(work) {
  const session = await mongoose.startSession();
  try {
    // The driver retries write conflicts and retries an uncertain commit without
    // rerunning the writes. Atlas supports these cross-collection transactions.
    return await session.withTransaction(work, transactionOptions);
  } finally {
    await session.endSession();
  }
}

export async function createBooking(input) {
  assertBookingWritesEnabled();
  const bookingReference = createBookingReference();
  const bookingId = new mongoose.Types.ObjectId();
  let result;

  try {
    result = await runBookingTransaction(async (session) => {
      const existing = await findExistingBooking(input, session);
      if (existing) {
        assertIdempotentRequestMatches(existing, input);
        return { bookingId: existing._id, idempotentReplay: true };
      }

      const userExists = await User.exists({
        _id: input.userId,
        status: "ACTIVE",
      }).session(session);
      if (!userExists) {
        throw serviceError("USER_NOT_FOUND", "Active user was not found", 404);
      }

      // Recheck departure on every retry; the guarded decrement prevents overselling.
      const flight = await Flight.findOneAndUpdate(
        {
          _id: input.flightId,
          status: { $in: bookableFlightStatuses },
          departureAt: { $gt: new Date() },
          availableSeats: { $gte: input.seatCount },
        },
        { $inc: { availableSeats: -input.seatCount } },
        { returnDocument: "after", session },
      );

      if (!flight) {
        throw serviceError(
          "FLIGHT_NOT_FOUND_OR_SOLD_OUT",
          "Flight does not exist, has departed, is unavailable, or has insufficient seats",
          409,
        );
      }

      const priceSnapshot = createPriceSnapshot(flight, input.seatCount);
      // The first argument must be an array: mongoose only treats { session } as options
      // in the array form, otherwise it tries to insert it as a second document.
      await Booking.create(
        [
          {
            _id: bookingId,
            bookingReference,
            user: input.userId,
            flight: input.flightId,
            seatCount: input.seatCount,
            source: input.source,
            status: "CONFIRMED",
            idempotencyKey: input.idempotencyKey,
            priceSnapshot,
          },
        ],
        { session },
      );
      return { bookingId, idempotentReplay: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      // Concurrent requests can target different flights with the same key.
      // The unique (user, idempotencyKey) index chooses the winner.
      const existing = await findExistingBooking(input);
      if (existing) {
        assertIdempotentRequestMatches(existing, input);
        return {
          booking: await loadBookingResponse(existing._id),
          idempotentReplay: true,
        };
      }
    }

    if (error?.statusCode) {
      throw error;
    }

    console.error(
      "Booking creation could not be confirmed",
      {
        errorName: error?.name,
        errorCode: error?.code,
        bookingReference,
        flightId: input.flightId?.toString(),
      },
    );
    throw serviceError(
      "BOOKING_CREATION_FAILED",
      "Booking could not be confirmed; retry with the same idempotency key",
      500,
    );
  }

  return {
    booking: await loadBookingResponse(result.bookingId),
    idempotentReplay: result.idempotentReplay,
  };
}

function isBookableFlight(flight, now) {
  return (
    flight &&
    bookableFlightStatuses.includes(flight.status) &&
    new Date(flight.departureAt) > now
  );
}

export async function cancelBooking({ userId, bookingId }) {
  const alreadyCancelled = await cancelBookingRecord(
    { _id: bookingId, user: userId },
    { cancellationSource: "USER", cancelledBy: userId, cancellationReason: null },
  );
  return {
    booking: await loadBookingResponse(bookingId),
    alreadyCancelled,
  };
}

// Shared by the owner and administrator services; each supplies its own access filter.
export async function cancelBookingRecord(filter, cancellation) {
  assertBookingWritesEnabled();

  try {
    return await runBookingTransaction(async (session) => {
      const booking = await Booking.findOne(filter).session(session);
      if (!booking) {
        throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
      }
      // Check the latest status on every retry before checking flight eligibility.
      if (booking.status === "CANCELLED") return true;

      const cancelledAt = new Date();
      const flight = await Flight.findById(booking.flight)
        .select("status departureAt totalSeats availableSeats")
        .session(session);
      if (!flight) {
        throw consistencyError({
          operation: "CANCEL_FLIGHT_MISSING",
          bookingId: booking._id,
          flightId: booking.flight,
        });
      }
      if (!isBookableFlight(flight, cancelledAt)) {
        throw serviceError(
          "BOOKING_NOT_CANCELLABLE",
          "Only bookings for upcoming scheduled or delayed flights can be cancelled",
          409,
        );
      }

      const transitioned = await Booking.findOneAndUpdate(
        {
          ...filter,
          status: "CONFIRMED",
        },
        {
          $set: {
            status: "CANCELLED",
            cancelledAt,
            ...cancellation,
          },
        },
        { returnDocument: "after", runValidators: true, session },
      );

      if (!transitioned) {
        throw serviceError("BOOKING_NOT_CANCELLABLE", "Booking is not confirmed", 409);
      }

      const restoration = await Flight.updateOne(
        {
          _id: flight._id,
          status: { $in: bookableFlightStatuses },
          departureAt: { $gt: cancelledAt },
          availableSeats: {
            $lte: flight.totalSeats - transitioned.seatCount,
          },
        },
        { $inc: { availableSeats: transitioned.seatCount } },
        { session },
      );

      if (restoration.matchedCount !== 1) {
        // Abort both writes instead of restoring more seats than the flight holds.
        throw consistencyError({
          operation: "CANCEL_RESTORE_GUARD_FAILED",
          bookingId: transitioned._id,
          flightId: flight._id,
        });
      }

      return false;
    });
  } catch (error) {
    if (error?.statusCode) {
      throw error;
    }

    console.error(
      "Booking cancellation could not be confirmed",
      {
        errorName: error?.name,
        errorCode: error?.code,
        bookingId: filter._id?.toString(),
      },
    );
    throw serviceError(
      "BOOKING_CANCELLATION_FAILED",
      "Cancellation could not be confirmed; retry cancellation for the same booking",
      500,
    );
  }
}

export async function listBookingsForUser({ userId, page = 1, limit = 20 }) {
  const filter = { user: userId };
  const skip = (page - 1) * limit;
  const [bookings, totalItems] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1, _id: -1 })
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

export async function getBookingForUser({ userId, bookingId }) {
  const booking = await Booking.findOne({
    _id: bookingId,
    user: userId,
  })
    .populate({ path: "flight", populate: flightPopulate })
    .lean();
  if (!booking) {
    throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
  }

  return toBookingResponse(booking);
}
