import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import User from "../models/User.js";

const applyChanges = process.argv.includes("--apply");
const missingRoleFilter = {
  $or: [
    { role: { $exists: false } },
    { role: null },
    { role: { $nin: ["USER", "ADMIN"] } },
  ],
};
const missingCancellationFilter = {
  status: "CANCELLED",
  $or: [
    { cancellationSource: { $exists: false } },
    { cancellationSource: null },
  ],
};

async function inspect() {
  const [users, bookings] = await Promise.all([
    User.find(missingRoleFilter).select("email role").lean(),
    Booking.find(missingCancellationFilter)
      .select("user cancellationSource cancelledAt")
      .lean(),
  ]);
  return {
    users: users.map((user) => ({
      userId: user._id.toString(),
      email: user.email,
      currentRole: user.role ?? null,
    })),
    bookings: bookings.map((booking) => ({
      bookingId: booking._id.toString(),
      userId: booking.user.toString(),
      cancelledAt: booking.cancelledAt?.toISOString?.() ?? null,
      currentCancellationSource: booking.cancellationSource ?? null,
    })),
  };
}

async function migrateAdminData() {
  if (applyChanges && process.env.BOOKING_WRITES_PAUSED !== "true") {
    throw new Error(
      "--apply requires BOOKING_WRITES_PAUSED=true and a maintenance window with Booking writes actually paused",
    );
  }

  const connection = await connectDatabase();
  const before = await inspect();
  console.log(
    JSON.stringify(
      {
        database: connection.name,
        mode: applyChanges ? "APPLY" : "REPORT_ONLY",
        missingUserRoleCount: before.users.length,
        missingBookingCancellationCount: before.bookings.length,
        missingUserRoles: before.users,
        missingBookingCancellations: before.bookings,
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

  if (before.users.length > 0) {
    await User.updateMany(missingRoleFilter, { $set: { role: "USER" } });
  }
  if (before.bookings.length > 0) {
    await Booking.bulkWrite(
      before.bookings.map((booking) => ({
        updateOne: {
          filter: {
            _id: booking.bookingId,
            status: "CANCELLED",
            $or: [
              { cancellationSource: { $exists: false } },
              { cancellationSource: null },
            ],
          },
          update: {
            $set: {
              cancellationSource: "USER",
              cancelledBy: booking.userId,
              cancellationReason: null,
            },
          },
        },
      })),
      { ordered: true },
    );
  }

  await Promise.all([
    User.createIndexes(),
    Booking.createIndexes(),
    Flight.createIndexes(),
  ]);

  const after = await inspect();
  if (after.users.length > 0 || after.bookings.length > 0) {
    throw new Error(
      `Migration verification failed: ${after.users.length} users and ${after.bookings.length} bookings remain`,
    );
  }
  console.log("Administrator data migration completed and verified");
}

try {
  await migrateAdminData();
} catch (error) {
  console.error("Administrator data migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
