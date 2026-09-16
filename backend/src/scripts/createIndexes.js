import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import Session from "../models/Session.js";
import Turn from "../models/Turn.js";
import User from "../models/User.js";

async function createIndexes() {
  await connectDatabase();
  await Promise.all([
    Flight.createIndexes(),
    Booking.createIndexes(),
    Session.createIndexes(),
    Turn.createIndexes(),
    User.createIndexes(),
  ]);
  console.log("Flight, Booking, Session, Turn, and User indexes created");
}

try {
  await createIndexes();
} catch (error) {
  console.error("Index creation failed:", error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
