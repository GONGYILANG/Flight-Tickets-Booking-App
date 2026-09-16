import { spawnSync } from "node:child_process";
import { developmentDatabaseName, testDatabaseName } from "./testDatabase.js";

const seed = spawnSync(process.execPath, ["src/scripts/seed.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    MONGODB_DB_NAME: testDatabaseName,
    MONGODB_TEST_DB_NAME: testDatabaseName,
  },
});
if (seed.error) throw seed.error;
if (seed.status !== 0) {
  process.exitCode = seed.status ?? 1;
} else {
  const tests = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        MONGODB_DB_NAME: developmentDatabaseName,
        MONGODB_TEST_DB_NAME: testDatabaseName,
      },
    },
  );
  if (tests.error) throw tests.error;
  process.exitCode = tests.status ?? 1;
}
