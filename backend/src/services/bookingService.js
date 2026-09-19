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

const transactionAttempts = 5;
const transactionRetryDelayMs = 20;

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

function toPricingResponse(priceSnapshot) {
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

  return priceSnapshot
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

async function findExistingBooking(input) {
  return Booking.findOne({
    user: input.userId,
    idempotencyKey: input.idempotencyKey,
  });
}

// A booking for this (user, idempotencyKey) may already exist because a concurrent
// duplicate submission committed first. One read is enough: the unique index makes
// the winner the only possible match, and it is already visible by the time any
// conflicting error surfaces.
async function replayIfAlreadyBooked(input) {
  const existing = await findExistingBooking(input);
  if (!existing) {
    return null;
  }

  return replayResult(existing, input);
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

const transactionOptions = {
  // Every read inside the transaction shares one snapshot, so the guard conditions
  // and the writes evaluate the same data.
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
};

// The driver labels a failed transaction body with TransientTransactionError when it
// guarantees nothing was committed, which makes replaying the body safe.
function isTransientTransactionError(error) {
  return error?.hasErrorLabel?.("TransientTransactionError") ?? false;
}

async function runBookingTransaction(work) {
  for (let attempt = 1; ; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction(transactionOptions);
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction().catch(() => {});
      }

      // Transient errors such as write conflicts are safe to replay as a whole;
      // anything else is rethrown.
      if (
        attempt >= transactionAttempts ||
        !isTransientTransactionError(error)
      ) {
        throw error;
      }
      await delay(attempt * transactionRetryDelayMs);
    } finally {
      await session.endSession();
    }
  }
}

async function tryCreateBooking(input) {
  const now = new Date();
  const bookingReference = createBookingReference();
  const bookingId = new mongoose.Types.ObjectId();

  try {
    await runBookingTransaction(async (session) => {
      // A retry can find that a concurrent request with the same key already
      // committed. Bail out before touching the flight document: the deduction
      // would only be rolled back, and the extra write raises the conflict rate
      // for every other transaction on that flight.
      const duplicate = await Booking.findOne(
        { user: input.userId, idempotencyKey: input.idempotencyKey },
        { _id: 1 },
        { session },
      ).lean();
      if (duplicate) {
        throw serviceError(
          "IDEMPOTENT_REPLAY",
          "A booking with this idempotency key is already committed",
          409,
        );
      }

      // Guarded update plus seat deduction. This is the single point of contention when
      // requests race for the last seats: MongoDB serialises them, and the losers get a
      // transient error that replays the whole transaction.
      const flight = await Flight.findOneAndUpdate(
        {
          _id: input.flightId,
          status: { $in: bookableFlightStatuses },
          departureAt: { $gt: now },
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
    });
  } catch (error) {
    if (error?.code === "FLIGHT_NOT_FOUND_OR_SOLD_OUT") {
      // The seats may have gone to a concurrent duplicate submission of this same
      // request. If not, the flight really is full, departed, or unavailable.
      const replay = await replayIfAlreadyBooked(input);
      if (replay) {
        return replay;
      }
      throw error;
    }

    if (error?.code === 11000 || error?.code === "IDEMPOTENT_REPLAY") {
      // The unique index allows one booking per (user, idempotencyKey), so a duplicate
      // key here always points at a booking that already committed.
      const replay = await replayIfAlreadyBooked(input);
      if (replay) {
        return replay;
      }
    }

    // Already a well-defined business error (for example a pricing failure);
    // rethrow it untouched.
    if (error?.statusCode) {
      throw error;
    }

    console.error(
      "Booking creation failed and the transaction was rolled back",
      {
        errorName: error?.name,
        errorCode: error?.code,
        bookingReference,
        flightId: input.flightId?.toString(),
      },
    );
    throw serviceError(
      "BOOKING_CREATION_FAILED",
      "Booking could not be created; no seats were charged",
      500,
    );
  }

  return {
    booking: await loadBookingResponse(bookingId),
    idempotentReplay: false,
  };
}

export async function createBooking(input) {
  assertBookingWritesEnabled();
  const existing = await findExistingBooking(input);
  if (existing) {
    return replayResult(existing, input);
  }

  const userExists = await User.exists({
    _id: input.userId,
    status: "ACTIVE",
  });
  if (!userExists) {
    throw serviceError("USER_NOT_FOUND", "Active user was not found", 404);
  }

  return tryCreateBooking(input);
}

function isBookableFlight(flight, now) {
  return (
    flight &&
    bookableFlightStatuses.includes(flight.status) &&
    new Date(flight.departureAt) > now
  );
}

async function cancelledResult(booking, alreadyCancelled) {
  return {
    booking: await loadBookingResponse(booking._id),
    alreadyCancelled,
  };
}

export async function cancelBooking({ userId, bookingId }) {
  assertBookingWritesEnabled();

  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) {
    throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
  }
  if (booking.status === "CANCELLED") {
    return cancelledResult(booking, true);
  }

  const cancelledAt = new Date();
  let alreadyCancelled;

  try {
    alreadyCancelled = await runBookingTransaction(async (session) => {
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

      // The status guard makes this a compare-and-set: a concurrent cancellation
      // matches nothing instead of cancelling the same booking twice.
      const transitioned = await Booking.findOneAndUpdate(
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
        { returnDocument: "after", session },
      );

      if (!transitioned) {
        // Lost the race against a concurrent cancellation. Commit a read-only
        // transaction so the inventory is never restored twice.
        return true;
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
        // The status and departure guards above already passed against this
        // snapshot, so the only guard left is availableSeats + seatCount <=
        // totalSeats: the stored inventory is already inconsistent and has to be
        // repaired instead of being written back blindly.
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
      "Booking cancellation failed and the transaction was rolled back",
      {
        errorName: error?.name,
        errorCode: error?.code,
        bookingId: bookingId?.toString(),
        flightId: booking.flight?.toString(),
      },
    );
    throw consistencyError({
      operation: "CANCEL_TRANSACTION_FAILED",
      bookingId,
      flightId: booking.flight,
    });
  }

  return cancelledResult(booking, alreadyCancelled);
}

export async function listBookingsForUser({ userId, page = 1, limit = 20 }) {
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
