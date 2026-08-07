import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";

async function createIndexes() {
  await connectDatabase();
  await Promise.all([Flight.createIndexes(), Booking.createIndexes()]);
  console.log("Flight and Booking indexes created");
}

try {
  await createIndexes();
} catch (error) {
  console.error("Index creation failed:", error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
