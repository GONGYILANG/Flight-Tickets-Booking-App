import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";

const compoundIndexName = "user_1_idempotencyKey_1";
const rebuildEmptyCollection = process.argv.includes("--rebuild-empty");

function isLegacyIdempotencyIndex(index) {
  const entries = Object.entries(index.key ?? {});
  return (
    index.name === "idempotencyKey_1" ||
    (entries.length === 1 &&
      entries[0][0] === "idempotencyKey" &&
      entries[0][1] === 1)
  );
}

function isLegacyPaginationIndex(index) {
  const entries = Object.entries(index.key ?? {});
  return (
    index.name === "user_1_createdAt_-1" ||
    (entries.length === 2 &&
      entries[0][0] === "user" &&
      entries[0][1] === 1 &&
      entries[1][0] === "createdAt" &&
      entries[1][1] === -1)
  );
}

async function rebuildEmptyBookingsCollection() {
  if (process.env.BOOKING_WRITES_PAUSED !== "true") {
    throw new Error(
      "--rebuild-empty requires BOOKING_WRITES_PAUSED=true and all Booking API writers to be paused",
    );
  }

  const latestCount = await Booking.countDocuments();
  if (latestCount !== 0) {
    throw new Error("Refusing to rebuild a non-empty bookings collection");
  }

  await Booking.collection.drop();
  await Booking.createCollection();
  await Booking.createIndexes();
  console.log("Rebuilt the empty bookings collection and created its indexes");
}

async function migrateBookingIndexes() {
  const connection = await connectDatabase();
  const bookingCount = await Booking.countDocuments();
  console.log(`Database: ${connection.name}`);
  console.log(`Bookings before migration: ${bookingCount}`);

  try {
    await Booking.collection.createIndex(
      { user: 1, idempotencyKey: 1 },
      { unique: true, name: compoundIndexName },
    );
  } catch (error) {
    if (bookingCount === 0 && rebuildEmptyCollection) {
      await rebuildEmptyBookingsCollection();
      return;
    }

    if (bookingCount === 0) {
      throw new Error(
        "Cosmos DB refused the compound unique index on the empty collection. " +
          "Re-run with --rebuild-empty to explicitly rebuild only the empty bookings collection.",
      );
    }
    throw error;
  }

  const indexes = await Booking.collection.indexes();
  const legacyIndexes = indexes.filter(
    (index) =>
      isLegacyIdempotencyIndex(index) || isLegacyPaginationIndex(index),
  );
  for (const index of legacyIndexes) {
    await Booking.collection.dropIndex(index.name);
    console.log(`Dropped legacy index: ${index.name}`);
  }

  await Booking.createIndexes();
  const finalIndexes = await Booking.collection.indexes();
  console.log(
    `Booking indexes: ${finalIndexes.map(({ name }) => name).join(", ")}`,
  );
}

try {
  await migrateBookingIndexes();
} catch (error) {
  console.error("Booking index migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
