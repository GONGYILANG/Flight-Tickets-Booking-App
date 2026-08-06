import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import User from "../models/User.js";

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireObjectId(value, fieldName) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw serviceError("INVALID_ID", `${fieldName} is not a valid ObjectId`);
  }
}

export async function createBooking({
  userId,
  flightId,
  seatCount = 1,
  source = "UI",
  idempotencyKey,
}) {
  requireObjectId(userId, "userId");
  requireObjectId(flightId, "flightId");

  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 9) {
    throw serviceError("INVALID_SEAT_COUNT", "seatCount must be an integer from 1 to 9");
  }

  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw serviceError("INVALID_IDEMPOTENCY_KEY", "idempotencyKey is required");
  }

  if (!['UI', 'AI'].includes(source)) {
    throw serviceError("INVALID_SOURCE", "source must be UI or AI");
  }

  return mongoose.connection.transaction(async (session) => {
    const existing = await Booking.findOne({ idempotencyKey }).session(session);

    if (existing) {
      if (existing.user.toString() !== userId.toString()) {
        throw serviceError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key already belongs to another user",
        );
      }

      return existing;
    }

    const userExists = await User.exists({
      _id: userId,
      status: "ACTIVE",
    }).session(session);

    if (!userExists) {
      throw serviceError("USER_NOT_FOUND", "Active user was not found");
    }

    const flight = await Flight.findOneAndUpdate(
      {
        _id: flightId,
        status: "SCHEDULED",
        availableSeats: { $gte: seatCount },
      },
      {
        $inc: { availableSeats: -seatCount },
      },
      {
        new: true,
        session,
      },
    );

    if (!flight) {
      throw serviceError(
        "FLIGHT_NOT_FOUND_OR_SOLD_OUT",
        "Flight does not exist, is unavailable, or has insufficient seats",
      );
    }

    const bookingReference = `BK${randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)}`.toUpperCase();

    const [booking] = await Booking.create(
      [
        {
          bookingReference,
          user: userId,
          flight: flightId,
          seatCount,
          source,
          status: "CONFIRMED",
          idempotencyKey,
        },
      ],
      { session },
    );

    return booking;
  });
}

export async function cancelBooking({ userId, bookingId }) {
  requireObjectId(userId, "userId");
  requireObjectId(bookingId, "bookingId");

  return mongoose.connection.transaction(async (session) => {
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        user: userId,
        status: "CONFIRMED",
      },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      },
      {
        new: true,
        session,
      },
    );

    if (!booking) {
      throw serviceError(
        "BOOKING_NOT_FOUND_OR_ALREADY_CANCELLED",
        "Confirmed booking was not found",
      );
    }

    const flightUpdate = await Flight.updateOne(
      { _id: booking.flight },
      { $inc: { availableSeats: booking.seatCount } },
      { session },
    );

    if (flightUpdate.matchedCount !== 1) {
      throw serviceError("FLIGHT_NOT_FOUND", "Booked flight was not found");
    }

    return booking;
  });
}

export async function listBookingsForUser(userId) {
  requireObjectId(userId, "userId");

  return Booking.find({ user: userId })
    .populate({
      path: "flight",
      populate: [
        { path: "airline", select: "code name" },
        { path: "originAirport", select: "iataCode name cityName timezone" },
        {
          path: "destinationAirport",
          select: "iataCode name cityName timezone",
        },
      ],
    })
    .sort({ createdAt: -1 })
    .lean();
}
