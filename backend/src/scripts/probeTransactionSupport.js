import { randomUUID } from "node:crypto";
import "dotenv/config";

function requireTestDatabaseName() {
  const developmentName = process.env.MONGODB_DB_NAME || "flightBookingDB";
  const testName = process.env.MONGODB_TEST_DB_NAME?.trim();
  if (!testName) {
    throw new Error("MONGODB_TEST_DB_NAME is required for the transaction probe");
  }
  if (testName.toLowerCase() === developmentName.toLowerCase()) {
    throw new Error(
      "MONGODB_TEST_DB_NAME must be different from MONGODB_DB_NAME",
    );
  }
  return testName;
}

let disconnectDatabase;
let session;
let firstCollection;
let secondCollection;

try {
  process.env.MONGODB_DB_NAME = requireTestDatabaseName();
  const databaseModule = await import("../config/database.js");
  ({ disconnectDatabase } = databaseModule);
  const connection = await databaseModule.connectDatabase();
  const suffix = randomUUID().replaceAll("-", "");
  firstCollection = connection.db.collection(`transaction_probe_a_${suffix}`);
  secondCollection = connection.db.collection(`transaction_probe_b_${suffix}`);
  const marker = randomUUID();

  await Promise.all([
    firstCollection.insertOne({ marker, value: 0 }),
    secondCollection.insertOne({ marker, value: 0 }),
  ]);

  session = await connection.startSession();
  let supported = false;
  let transactionError = null;
  session.startTransaction();
  try {
    await firstCollection.updateOne(
      { marker },
      { $set: { value: 1 } },
      { session },
    );
    await secondCollection.updateOne(
      { marker },
      { $set: { value: 1 } },
      { session },
    );
    await session.commitTransaction();
    supported = true;
  } catch (error) {
    transactionError = error;
    await session.abortTransaction().catch(() => {});
  }

  const [first, second] = await Promise.all([
    firstCollection.findOne({ marker }),
    secondCollection.findOne({ marker }),
  ]);
  const hasPartialOrUncommittedWrites = supported
    ? first?.value !== 1 || second?.value !== 1
    : first?.value !== 0 || second?.value !== 0;

  console.log(
    JSON.stringify(
      {
        database: connection.name,
        crossCollectionTransactionsSupported: supported,
        error: transactionError
          ? {
              name: transactionError.name,
              code: transactionError.code,
              codeName: transactionError.codeName,
              message: transactionError.message,
            }
          : null,
        residualWritesDetected: hasPartialOrUncommittedWrites,
      },
      null,
      2,
    ),
  );

  if (hasPartialOrUncommittedWrites) {
    throw new Error("Transaction probe detected unexpected residual writes");
  }
} catch (error) {
  console.error("Transaction probe failed:", error.message);
  process.exitCode = 1;
} finally {
  if (session) {
    await session.endSession();
  }
  for (const collection of [firstCollection, secondCollection]) {
    if (collection) {
      await collection.drop().catch(() => {});
    }
  }
  if (disconnectDatabase) {
    await disconnectDatabase();
  }
}
