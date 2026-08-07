import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";

const applyChanges = process.argv.includes("--apply");

async function reconcileBookings() {
  if (applyChanges && process.env.BOOKING_WRITES_PAUSED !== "true") {
    throw new Error(
      "--apply requires BOOKING_WRITES_PAUSED=true and a maintenance window with Booking writes actually paused",
    );
  }

  const connection = await connectDatabase();
  const [confirmedByFlight, flights] = await Promise.all([
    Booking.aggregate([
      { $match: { status: "CONFIRMED" } },
      {
        $group: {
          _id: "$flight",
          confirmedSeats: { $sum: "$seatCount" },
        },
      },
    ]),
    Flight.find({}).select("totalSeats availableSeats").lean(),
  ]);

  const confirmedSeatMap = new Map(
    confirmedByFlight.map(({ _id, confirmedSeats }) => [
      _id.toString(),
      confirmedSeats,
    ]),
  );
  const flightIdSet = new Set(flights.map(({ _id }) => _id.toString()));
  const orphanedBookingGroups = confirmedByFlight.filter(
    ({ _id }) => !flightIdSet.has(_id.toString()),
  );

  const mismatches = flights
    .map((flight) => {
      const confirmedSeats = confirmedSeatMap.get(flight._id.toString()) ?? 0;
      const expectedAvailableSeats = flight.totalSeats - confirmedSeats;
      return {
        flightId: flight._id.toString(),
        totalSeats: flight.totalSeats,
        confirmedSeats,
        actualAvailableSeats: flight.availableSeats,
        expectedAvailableSeats,
        difference: expectedAvailableSeats - flight.availableSeats,
        repairable:
          expectedAvailableSeats >= 0 &&
          expectedAvailableSeats <= flight.totalSeats,
      };
    })
    .filter(
      ({ actualAvailableSeats, expectedAvailableSeats }) =>
        actualAvailableSeats !== expectedAvailableSeats,
    );

  console.log(
    JSON.stringify(
      {
        database: connection.name,
        mode: applyChanges ? "APPLY" : "REPORT_ONLY",
        mismatchCount: mismatches.length,
        orphanedConfirmedBookingGroups: orphanedBookingGroups.map(
          ({ _id, confirmedSeats }) => ({
            flightId: _id.toString(),
            confirmedSeats,
          }),
        ),
        mismatches,
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

  let repairedCount = 0;
  for (const mismatch of mismatches) {
    if (!mismatch.repairable) {
      console.error(
        `Skipped ${mismatch.flightId}: confirmed seats exceed total seats`,
      );
      continue;
    }

    const result = await Flight.updateOne(
      {
        _id: mismatch.flightId,
        availableSeats: mismatch.actualAvailableSeats,
      },
      { $set: { availableSeats: mismatch.expectedAvailableSeats } },
    );
    if (result.matchedCount !== 1) {
      throw new Error(
        `Flight ${mismatch.flightId} changed during reconciliation; aborting`,
      );
    }
    repairedCount += 1;
  }

  console.log(`Repaired ${repairedCount} flight inventory record(s)`);
}

try {
  await reconcileBookings();
} catch (error) {
  console.error("Booking reconciliation failed:", error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
