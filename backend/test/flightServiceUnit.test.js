import assert from "node:assert/strict";
import { test } from "node:test";
import { getDepartureWindow } from "../src/services/flightService.js";

test("departure windows preserve a future local-day boundary", () => {
  const window = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: null },
    "Asia/Shanghai",
    new Date("2026-01-01T00:00:00.000Z"),
  );

  assert.equal(window.start.toISOString(), "2026-12-07T16:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-12-08T16:00:00.000Z");
});

test("departure windows clamp an in-progress day to the current instant", () => {
  const window = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: null },
    "Asia/Shanghai",
    new Date("2026-12-08T02:00:00.000Z"),
  );

  assert.equal(window.start.toISOString(), "2026-12-08T02:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-12-08T16:00:00.000Z");
});

test("departure windows return an empty interval after the requested period", () => {
  const window = getDepartureWindow(
    { departureDate: "2026-12-08", departurePeriod: "MORNING" },
    "Asia/Shanghai",
    new Date("2026-12-08T04:00:00.000Z"),
  );

  assert.equal(window.start.getTime(), window.end.getTime());
});

test("departure windows preserve daylight-saving day lengths", () => {
  const reference = new Date("2026-01-01T00:00:00.000Z");
  const spring = getDepartureWindow(
    { departureDate: "2026-03-08", departurePeriod: null },
    "America/New_York",
    reference,
  );
  const fall = getDepartureWindow(
    { departureDate: "2026-11-01", departurePeriod: null },
    "America/New_York",
    reference,
  );

  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(fall.end.getTime() - fall.start.getTime(), 25 * 60 * 60 * 1000);
});
