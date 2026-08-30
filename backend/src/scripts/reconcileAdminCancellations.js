import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";

const applyChanges = process.argv.includes("--apply");

async function inspect() {
  const cancelledFlights = await Flight.find({ status: "CANCELLED" })
    .select(
      "totalSeats availableSeats statusUpdatedAt statusUpdatedBy statusReason",
    )
    .lean();
  const flightIds = cancelledFlights.map((flight) => flight._id);
  const [confirmedBookings, missingCancellationBookings] = await Promise.all([
    flightIds.length > 0
      ? Booking.find({ flight: { $in: flightIds }, status: "CONFIRMED" })
          .select("flight")
          .lean()
      : [],
    Booking.find({
      status: "CANCELLED",
      $or: [
        { cancellationSource: { $exists: false } },
        { cancellationSource: null },
      ],
    })
      .select("user flight cancelledAt")
      .lean(),
  ]);

  return {
    cancelledFlights,
    confirmedBookings,
    missingCancellationBookings,
    inventoryMismatches: cancelledFlights.filter(
      (flight) => flight.availableSeats !== flight.totalSeats,
    ),
  };
}

async function reconcileAdminCancellations() {
  if (applyChanges && process.env.BOOKING_WRITES_PAUSED !== "true") {
    throw new Error(
      "--apply requires BOOKING_WRITES_PAUSED=true and a maintenance window with Booking writes actually paused",
    );
  }

  const connection = await connectDatabase();
  const report = await inspect();
  console.log(
    JSON.stringify(
      {
        database: connection.name,
        mode: applyChanges ? "APPLY" : "REPORT_ONLY",
        cancelledFlightCount: report.cancelledFlights.length,
        confirmedBookingOnCancelledFlightCount: report.confirmedBookings.length,
        missingCancellationSourceCount:
          report.missingCancellationBookings.length,
        inventoryMismatchCount: report.inventoryMismatches.length,
        confirmedBookingsOnCancelledFlights: report.confirmedBookings.map(
          (booking) => ({
            bookingId: booking._id.toString(),
            flightId: booking.flight.toString(),
          }),
        ),
        inventoryMismatches: report.inventoryMismatches.map((flight) => ({
          flightId: flight._id.toString(),
          totalSeats: flight.totalSeats,
          availableSeats: flight.availableSeats,
        })),
      },
      null,
      2,
    ),
  );

  if (!applyChanges) {
    console.log(
      "No changes applied. Pause Booking writes, then use --apply with BOOKING_WRITES_PAUSED=true.",
    );
    return;
  }

  const cancelledFlightById = new Map(
    report.cancelledFlights.map((flight) => [flight._id.toString(), flight]),
  );
  for (const flight of report.cancelledFlights) {
    const cancelledAt = flight.statusUpdatedAt ?? new Date();
    await Booking.updateMany(
      { flight: flight._id, status: "CONFIRMED" },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt,
          cancellationSource: "FLIGHT",
          cancelledBy: flight.statusUpdatedBy ?? null,
          cancellationReason: flight.statusReason ?? null,
        },
      },
    );
    await Flight.updateOne(
      { _id: flight._id, status: "CANCELLED" },
      { $set: { availableSeats: flight.totalSeats } },
    );
  }

  for (const booking of report.missingCancellationBookings) {
    const cancelledFlight = cancelledFlightById.get(booking.flight.toString());
    await Booking.updateOne(
      {
        _id: booking._id,
        status: "CANCELLED",
        $or: [
          { cancellationSource: { $exists: false } },
          { cancellationSource: null },
        ],
      },
      {
        $set: cancelledFlight
          ? {
              cancellationSource: "FLIGHT",
              cancelledBy: cancelledFlight.statusUpdatedBy ?? null,
              cancellationReason: cancelledFlight.statusReason ?? null,
            }
          : {
              cancellationSource: "USER",
              cancelledBy: booking.user,
              cancellationReason: null,
            },
      },
    );
  }

  const after = await inspect();
  if (
    after.confirmedBookings.length > 0 ||
    after.missingCancellationBookings.length > 0 ||
    after.inventoryMismatches.length > 0
  ) {
    throw new Error("Administrator cancellation reconciliation did not converge");
  }
  console.log("Administrator cancellation reconciliation completed and verified");
}

try {
  await reconcileAdminCancellations();
} catch (error) {
  console.error("Administrator cancellation reconciliation failed:", error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
