import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import User from "../models/User.js";
import { toBookingResponse } from "./bookingService.js";
import { toFlightResponse } from "./flightService.js";

const bookableFlightStatuses = new Set(["SCHEDULED", "DELAYED"]);
const allowedStatusTransitions = new Map([
  ["SCHEDULED", new Set(["DELAYED", "CANCELLED", "DEPARTED"])],
  ["DELAYED", new Set(["SCHEDULED", "CANCELLED", "DEPARTED"])],
  ["DEPARTED", new Set(["ARRIVED"])],
  ["CANCELLED", new Set()],
  ["ARRIVED", new Set()],
]);
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
const bookingPopulate = [
  { path: "user", select: "email displayName status role" },
  { path: "cancelledBy", select: "email displayName status role" },
  { path: "flight", populate: flightPopulate },
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

function toIsoString(value) {
  return value ? new Date(value).toISOString() : null;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toAdminUserSummary(user) {
  if (!user) {
    return null;
  }
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role ?? "USER",
  };
}

export function toAdminUserResponse(user) {
  return {
    ...toAdminUserSummary(user),
    createdAt: toIsoString(user.createdAt),
    updatedAt: toIsoString(user.updatedAt),
  };
}

function toAdminBookingResponse(booking) {
  const response = toBookingResponse(booking);
  return {
    ...response,
    user: toAdminUserSummary(booking.user),
    cancellation: response.cancellation
      ? {
          ...response.cancellation,
          cancelledBy: toAdminUserSummary(booking.cancelledBy),
        }
      : null,
  };
}

function toAdminFlightResponse(flight) {
  return {
    ...toFlightResponse(flight),
    priceCents: flight.priceCents,
    statusUpdatedAt: toIsoString(flight.statusUpdatedAt),
    statusReason: flight.statusReason ?? null,
  };
}

async function loadAdminBooking(bookingId) {
  const booking = await Booking.findById(bookingId)
    .populate(bookingPopulate)
    .lean();
  if (!booking) {
    throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
  }
  return toAdminBookingResponse(booking);
}

async function loadAdminFlight(flightId) {
  const flight = await Flight.findById(flightId)
    .populate(flightPopulate)
    .lean();
  if (!flight) {
    throw serviceError("FLIGHT_NOT_FOUND", "Flight was not found", 404);
  }
  return toAdminFlightResponse(flight);
}

function adminConsistencyError(operation, context = {}) {
  console.error("Administrator operation consistency failure", {
    operation,
    userId: context.userId?.toString(),
    bookingId: context.bookingId?.toString(),
    flightId: context.flightId?.toString(),
  });
  return serviceError(
    "ADMIN_CONSISTENCY_ERROR",
    "The administrator operation is incomplete and requires reconciliation",
    500,
  );
}

export async function listAdminUsers({ query, status, role, page, limit }) {
  const filter = {};
  if (query) {
    const expression = new RegExp(escapeRegularExpression(query), "i");
    filter.$or = [{ email: expression }, { displayName: expression }];
  }
  if (status) {
    filter.status = status;
  }
  if (role) {
    filter.role = role;
  }

  const skip = (page - 1) * limit;
  const [users, totalItems] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    users: users.map(toAdminUserResponse),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
}

export async function getAdminUser(userId) {
  requireObjectId(userId, "userId");
  const user = await User.findById(userId)
    .populate({
      path: "statusUpdatedBy",
      select: "email displayName status role",
    })
    .lean();
  if (!user) {
    throw serviceError("USER_NOT_FOUND", "User was not found", 404);
  }

  const [total, confirmed, cancelled] = await Promise.all([
    Booking.countDocuments({ user: userId }),
    Booking.countDocuments({ user: userId, status: "CONFIRMED" }),
    Booking.countDocuments({ user: userId, status: "CANCELLED" }),
  ]);

  return {
    user: toAdminUserResponse(user),
    statusChange: user.statusUpdatedAt
      ? {
          updatedAt: toIsoString(user.statusUpdatedAt),
          updatedBy: toAdminUserSummary(user.statusUpdatedBy),
          reason: user.statusReason ?? null,
        }
      : null,
    bookingSummary: { total, confirmed, cancelled },
  };
}

export async function updateAdminUserStatus({
  actorId,
  userId,
  status,
  reason,
}) {
  const user = await User.findById(userId);
  if (!user) {
    throw serviceError("USER_NOT_FOUND", "User was not found", 404);
  }

  if (user.status === status) {
    return { user: toAdminUserResponse(user), changed: false };
  }
  if (user.role === "ADMIN" && user.status === "ACTIVE" && status !== "ACTIVE") {
    throw serviceError(
      "ADMIN_STATUS_CHANGE_FORBIDDEN",
      "The status of active administrators cannot be changed by other administrators",
      409,
    );
  }

  const changedAt = new Date();
  const updated = await User.findOneAndUpdate(
    { _id: user._id, status: user.status },
    {
      $set: {
        status,
        statusUpdatedAt: changedAt,
        statusUpdatedBy: actorId,
        statusReason: reason,
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) {
    const current = await User.findById(userId);
    if (!current) {
      throw serviceError("USER_NOT_FOUND", "User was not found", 404);
    }
    if (current.status === status) {
      return { user: toAdminUserResponse(current), changed: false };
    }
    throw serviceError(
      "USER_STATUS_CONFLICT",
      "The user status changed concurrently; retry the request",
      409,
    );
  }

  return { user: toAdminUserResponse(updated), changed: true };
}

export async function listAdminBookings(criteria) {
  const filter = {};
  if (criteria.userId) {
    filter.user = criteria.userId;
  }
  if (criteria.flightId) {
    filter.flight = criteria.flightId;
  }
  if (criteria.bookingReference) {
    filter.bookingReference = criteria.bookingReference;
  }
  if (criteria.status) {
    filter.status = criteria.status;
  }
  if (criteria.source) {
    filter.source = criteria.source;
  }
  if (criteria.createdFrom || criteria.createdTo) {
    filter.createdAt = {};
    if (criteria.createdFrom) {
      filter.createdAt.$gte = criteria.createdFrom;
    }
    if (criteria.createdTo) {
      filter.createdAt.$lte = criteria.createdTo;
    }
  }

  const skip = (criteria.page - 1) * criteria.limit;
  const [bookings, totalItems] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(criteria.limit)
      .populate(bookingPopulate)
      .lean(),
    Booking.countDocuments(filter),
  ]);

  return {
    bookings: bookings.map(toAdminBookingResponse),
    pagination: {
      page: criteria.page,
      limit: criteria.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / criteria.limit),
    },
  };
}

export async function getAdminBooking(bookingId) {
  requireObjectId(bookingId, "bookingId");
  return loadAdminBooking(bookingId);
}

async function rollbackAdminCancellation(booking, cancelledAt) {
  try {
    const result = await Booking.updateOne(
      {
        _id: booking._id,
        status: "CANCELLED",
        cancelledAt,
        cancellationSource: "ADMIN",
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

export async function cancelAdminBooking({ actorId, bookingId, reason }) {
  assertBookingWritesEnabled();
  requireObjectId(actorId, "actorId");
  requireObjectId(bookingId, "bookingId");

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
  }
  if (booking.status === "CANCELLED") {
    return { booking: await loadAdminBooking(bookingId), alreadyCancelled: true };
  }

  const now = new Date();
  const flight = await Flight.findById(booking.flight).select(
    "status departureAt totalSeats availableSeats",
  );
  if (
    !flight ||
    !bookableFlightStatuses.has(flight.status) ||
    new Date(flight.departureAt) <= now
  ) {
    throw serviceError(
      "BOOKING_NOT_CANCELLABLE",
      "Only bookings for upcoming scheduled or delayed flights can be cancelled",
      409,
    );
  }

  let transitioned;
  try {
    transitioned = await Booking.findOneAndUpdate(
      { _id: bookingId, status: "CONFIRMED" },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt: now,
          cancellationSource: "ADMIN",
          cancelledBy: actorId,
          cancellationReason: reason,
        },
      },
      { returnDocument: "after", runValidators: true },
    );
  } catch (_error) {
    throw adminConsistencyError("ADMIN_CANCEL_TRANSITION_UNKNOWN", {
      bookingId,
      flightId: booking.flight,
    });
  }

  if (!transitioned) {
    const current = await Booking.findById(bookingId);
    if (!current) {
      throw serviceError("BOOKING_NOT_FOUND", "Booking was not found", 404);
    }
    if (current.status === "CANCELLED") {
      return { booking: await loadAdminBooking(bookingId), alreadyCancelled: true };
    }
    throw serviceError(
      "BOOKING_NOT_CANCELLABLE",
      "Booking could not be cancelled in its current state",
      409,
    );
  }

  let restoration;
  try {
    restoration = await Flight.updateOne(
      {
        _id: flight._id,
        status: { $in: [...bookableFlightStatuses] },
        departureAt: { $gt: now },
        availableSeats: { $lte: flight.totalSeats - transitioned.seatCount },
      },
      { $inc: { availableSeats: transitioned.seatCount } },
    );
  } catch (_error) {
    throw adminConsistencyError("ADMIN_CANCEL_RESTORE_UNKNOWN", {
      bookingId,
      flightId: flight._id,
    });
  }

  if (restoration.matchedCount !== 1) {
    const rolledBack = await rollbackAdminCancellation(transitioned, now);
    if (!rolledBack) {
      throw adminConsistencyError("ADMIN_CANCEL_RESTORE_ROLLBACK_FAILED", {
        bookingId,
        flightId: flight._id,
      });
    }
    throw serviceError(
      "BOOKING_NOT_CANCELLABLE",
      "The flight is no longer eligible for cancellation",
      409,
    );
  }

  return { booking: await loadAdminBooking(bookingId), alreadyCancelled: false };
}

function assertStatusTransition(currentStatus, requestedStatus) {
  if (requestedStatus === currentStatus) {
    return;
  }
  if (!allowedStatusTransitions.get(currentStatus)?.has(requestedStatus)) {
    throw serviceError(
      "INVALID_STATUS_TRANSITION",
      `Flight status cannot change from ${currentStatus} to ${requestedStatus}`,
      409,
    );
  }
}

async function cancelBookingsForFlight({ flight, actorId, reason }) {
  const cancelledAt = flight.statusUpdatedAt
    ? new Date(flight.statusUpdatedAt)
    : new Date();
  let result;
  try {
    result = await Booking.updateMany(
      { flight: flight._id, status: "CONFIRMED" },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt,
          cancellationSource: "FLIGHT",
          cancelledBy: actorId,
          cancellationReason: flight.statusReason ?? reason,
        },
      },
      { runValidators: true },
    );
  } catch (_error) {
    throw adminConsistencyError("FLIGHT_CANCEL_BOOKINGS", {
      flightId: flight._id,
    });
  }

  try {
    const inventoryResult = await Flight.updateOne(
      { _id: flight._id, status: "CANCELLED" },
      { $set: { availableSeats: flight.totalSeats } },
    );
    if (inventoryResult.matchedCount !== 1) {
      throw new Error("Cancelled flight inventory update did not match");
    }
  } catch (_error) {
    throw adminConsistencyError("FLIGHT_CANCEL_INVENTORY", {
      flightId: flight._id,
    });
  }

  return result.modifiedCount;
}

export async function updateAdminFlight({ actorId, flightId, update }) {
  assertBookingWritesEnabled();
  requireObjectId(actorId, "actorId");
  requireObjectId(flightId, "flightId");

  const current = await Flight.findById(flightId);
  if (!current) {
    throw serviceError("FLIGHT_NOT_FOUND", "Flight was not found", 404);
  }

  if (update.hasPriceCents && !bookableFlightStatuses.has(current.status)) {
    throw serviceError(
      "FLIGHT_PRICE_NOT_EDITABLE",
      "Only scheduled or delayed flights can have their price changed",
      409,
    );
  }
  if (update.hasStatus) {
    assertStatusTransition(current.status, update.status);
  }

  const changedFields = [];
  const values = {};
  const statusChanged = update.hasStatus && update.status !== current.status;
  const priceChanged =
    update.hasPriceCents && update.priceCents !== current.priceCents;
  const changedAt = new Date();

  if (statusChanged) {
    changedFields.push("status");
    Object.assign(values, {
      status: update.status,
      statusUpdatedAt: changedAt,
      statusUpdatedBy: actorId,
      statusReason: update.reason,
    });
  }
  if (priceChanged) {
    changedFields.push("priceCents");
    values.priceCents = update.priceCents;
  }

  let updated = current;
  if (changedFields.length > 0) {
    try {
      updated = await Flight.findOneAndUpdate(
        {
          _id: current._id,
          status: current.status,
          priceCents: current.priceCents,
        },
        { $set: values },
        { returnDocument: "after", runValidators: true },
      );
    } catch (_error) {
      throw adminConsistencyError("FLIGHT_UPDATE_RESULT_UNKNOWN", {
        flightId: current._id,
      });
    }
    if (!updated) {
      throw serviceError(
        "FLIGHT_UPDATE_CONFLICT",
        "The flight changed concurrently; retry the request",
        409,
      );
    }
  }

  let affectedBookings = 0;
  const finalStatus = statusChanged ? update.status : current.status;
  if (update.hasStatus && finalStatus === "CANCELLED") {
    affectedBookings = await cancelBookingsForFlight({
      flight: updated,
      actorId,
      reason: update.reason,
    });
  }

  return {
    flight: await loadAdminFlight(flightId),
    changed: changedFields.length > 0,
    changedFields,
    affectedBookings,
  };
}
