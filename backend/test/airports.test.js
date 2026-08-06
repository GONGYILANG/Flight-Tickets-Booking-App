import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import "dotenv/config";
import request from "supertest";

process.env.NODE_ENV = "test";

const [{ default: app }, databaseModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/database.js"),
]);

const { connectDatabase, disconnectDatabase } = databaseModule;

before(async () => {
  await connectDatabase();
});

after(async () => {
  await disconnectDatabase();
});

test("airport search validates q and limit", async () => {
  const missingResponse = await request(app)
    .get("/api/airports/search")
    .expect(400);
  assert.deepEqual(
    missingResponse.body.error.details.fields.map(({ field }) => field),
    ["q"],
  );

  const invalidResponse = await request(app)
    .get("/api/airports/search")
    .query({ q: " ", limit: 21 })
    .expect(400);
  assert.deepEqual(
    invalidResponse.body.error.details.fields.map(({ field }) => field),
    ["q", "limit"],
  );
});

test("airport search matches IATA, city, and airport name", async () => {
  const iataResponse = await request(app)
    .get("/api/airports/search")
    .query({ q: "pek" })
    .expect(200);

  assert.equal(iataResponse.body.data.airports[0].iataCode, "PEK");
  assert.deepEqual(Object.keys(iataResponse.body.data.airports[0]).sort(), [
    "cityName",
    "countryCode",
    "iataCode",
    "id",
    "name",
    "timezone",
  ]);

  const cityResponse = await request(app)
    .get("/api/airports/search")
    .query({ q: "Beijing" })
    .expect(200);
  assert.deepEqual(
    cityResponse.body.data.airports.map(({ iataCode }) => iataCode).sort(),
    ["PEK", "PKX"],
  );

  const nameResponse = await request(app)
    .get("/api/airports/search")
    .query({ q: "Capital" })
    .expect(200);
  assert.ok(
    nameResponse.body.data.airports.some(({ iataCode }) => iataCode === "PEK"),
  );
});

test("airport search applies its limit and escapes regular expression input", async () => {
  const limitedResponse = await request(app)
    .get("/api/airports/search")
    .query({ q: "Beijing", limit: 1 })
    .expect(200);
  assert.equal(limitedResponse.body.data.airports.length, 1);

  const escapedResponse = await request(app)
    .get("/api/airports/search")
    .query({ q: ".*" })
    .expect(200);
  assert.deepEqual(escapedResponse.body.data.airports, []);
});
