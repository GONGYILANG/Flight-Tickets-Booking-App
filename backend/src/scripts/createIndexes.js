import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Flight from "../models/Flight.js";

async function createIndexes() {
  await connectDatabase();
  await Flight.createIndexes();
  console.log("Flight indexes created");
}

try {
  await createIndexes();
} catch (error) {
  console.error("Index creation failed:", error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
