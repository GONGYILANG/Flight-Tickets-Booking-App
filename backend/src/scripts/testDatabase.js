import "dotenv/config";

export const developmentDatabaseName =
  process.env.MONGODB_DB_NAME || "flightBookingDB";
export const testDatabaseName =
  process.env.MONGODB_TEST_DB_NAME?.trim() || "flightBookingDB_test";

if (testDatabaseName.toLowerCase() === developmentDatabaseName.toLowerCase()) {
  throw new Error("The test database must differ from the development database");
}

process.env.NODE_ENV = "test";
process.env.MONGODB_TEST_DB_NAME = testDatabaseName;
process.env.MONGODB_DB_NAME = testDatabaseName;
