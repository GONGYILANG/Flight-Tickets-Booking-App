import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import express from "express";
import airportRoutes from "../src/routes/airportRoutes.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import Airport from "../src/models/Airport.js";
import Session from "../src/models/Session.js";
import Turn from "../src/models/Turn.js";
import { toTurnEvents } from "../src/services/turnEvents.js";
import { getSessionForUser, finishTurn } from "../src/services/sessionService.js";
import { validateFinishTurn } from "../src/validators/sessionValidators.js";

const app = express();
app.use("/api/airports", airportRoutes);
app.use(errorHandler);

const airports = [
  ["PEK", "Beijing", "Beijing Capital International Airport"],
  ["PKX", "Beijing", "Beijing Daxing International Airport"],
  ["PVG", "Shanghai", "Shanghai Pudong International Airport"],
  ["IXC", "Chandigarh", "Shaheed Bhagat Singh International Airport"],
  ["BWI", "Baltimore", "Baltimore/Washington International Thurgood Marshall Airport"],
].map(([iataCode, cityName, name], index) => ({
  _id: String(index),
  id: String(index),
  iataCode,
  cityName,
  name,
  countryCode: "XX",
  timezone: "UTC",
}));

test("exact AI resolution avoids SHA substring collisions; autocomplete remains fuzzy", async (t) => {
  t.mock.method(Airport, "aggregate", async (pipeline) => {
    const conditions = pipeline[0].$match.$or;
    const limit = pipeline.find((stage) => stage.$limit).$limit;
    return airports
      .filter((airport) =>
        conditions.some((condition) =>
          Object.entries(condition).some(([field, regex]) => regex.test(airport[field])),
        ),
      )
      .slice(0, limit);
  });
  const codes = async (q, match) => {
    const response = await request(app)
      .get("/api/airports/search")
      .query({ q, ...(match && { match }) })
      .expect(200);
    return response.body.data.airports.map((airport) => airport.iataCode);
  };
  assert.deepEqual(
    await codes("SHA"),
    ["PVG", "IXC", "BWI"],
    "Reproduces the screenshot's unrelated matches",
  );
  assert.deepEqual(await codes("SHA", "exact"), []);
  assert.deepEqual(await codes("Shanghai", "exact"), ["PVG"]);
  assert.deepEqual(await codes("Beijing", "exact"), ["PEK", "PKX"]);
  assert.deepEqual(await codes("pek", "exact"), ["PEK"]);
  assert.deepEqual(await codes("Bei"), ["PEK", "PKX"]);
  assert.deepEqual(await codes("shang hai"), ["PVG"]);
  assert.deepEqual(await codes("  bei   jing  "), ["PEK", "PKX"]);
  assert.deepEqual(await codes("Beijing Capital"), ["PEK"]);
  assert.deepEqual(await codes("shang hai", "exact"), []);
  assert.deepEqual(await codes("Bei.* jing"), []);
  assert.deepEqual(await codes(".*", "exact"), []);
  await request(app)
    .get("/api/airports/search")
    .query({ q: "Shanghai", match: "unknown" })
    .expect(400);
});

function transcript() {
  const messages = [{ role: "user", content: "帮我订购一张从北京到上海的机票，日期是12月8日" }];
  for (const [index, [query, results]] of [
    ["Beijing", airports.slice(0, 2)],
    ["Shanghai", [airports[2]]],
    ["PEK", [airports[0]]],
    ["SHA", airports.slice(2)],
  ].entries()) {
    const id = `call-${index}`;
    messages.push({
      role: "assistant",
      content: null,
      reasoning_content: "preserve",
      tool_calls: [
        {
          id,
          type: "function",
          function: { name: "search_airports", arguments: JSON.stringify({ query }) },
        },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: id,
      content: JSON.stringify({ ok: true, status: 200, data: { airports: results } }),
    });
  }
  messages.push({ role: "assistant", content: "Choose a Beijing airport." });
  return messages;
}

test("airport cards remove duplicate/irrelevant options while the full trace stays intact", () => {
  const messages = transcript();
  const original = structuredClone(messages);
  const events = toTurnEvents(messages);
  assert.deepEqual(
    events.map((event) => event.result.data.airports.map((a) => a.iataCode)),
    [["PEK", "PKX"], ["PVG"]],
  );
  assert.deepEqual(messages, original);
  const req = {
    params: { turnId: "16deaf91-c2aa-48a9-b6cd-14d09ba50af9" },
    body: { status: "completed", messages },
  };
  validateFinishTurn(req, null, () => {});
  assert.deepEqual(req.validatedBody.view.events, events);
  assert.deepEqual(req.validatedBody.messages, original);
});

test("tool errors and non-airport cards are preserved", () => {
  const messages = transcript().slice(0, -1);
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "failure", function: { name: "search_airports", arguments: "invalid JSON" } },
      { id: "flight", function: { name: "search_flights", arguments: "{}" } },
    ],
  });
  const failed = { ok: false, status: 400, error: { code: "INVALID_TOOL_ARGUMENTS" } };
  const flights = { ok: true, status: 200, data: { flights: [] } };
  messages.push({ role: "tool", tool_call_id: "failure", content: JSON.stringify(failed) });
  messages.push({ role: "tool", tool_call_id: "flight", content: JSON.stringify(flights) });
  assert.deepEqual(toTurnEvents(messages).slice(-2), [
    { tool: "search_airports", result: failed },
    { tool: "search_flights", result: flights },
  ]);
});

test("legacy session reads and identical completion retries use the corrected projection without DB migration", async (t) => {
  const messages = transcript();
  const turn = {
    _id: "turn",
    turnId: "16deaf91-c2aa-48a9-b6cd-14d09ba50af9",
    sequence: 1,
    status: "completed",
    messages,
    view: {
      userMessage: messages[0].content,
      assistantMessage: messages.at(-1).content,
      events: [{ tool: "search_airports", result: { ok: true, data: { airports } } }],
    },
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const session = {
    _id: "session",
    sessionId: "d15ed6e0-e750-4af7-b284-001462f33279",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccess: new Date(),
  };
  const query = (value) => ({ lean: async () => value });
  t.mock.method(Session, "findOneAndUpdate", () => query(session));
  t.mock.method(Session, "findOne", () => query(session));
  t.mock.method(Session, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(Turn, "find", () => ({ sort: () => query([turn]) }));
  t.mock.method(Turn, "findOne", () => query(turn));
  t.mock.method(Turn, "findOneAndUpdate", () => query(null));
  const restored = await getSessionForUser({ userId: "user", sessionId: session.sessionId });
  const correctedView = { ...turn.view, events: toTurnEvents(messages) };
  assert.deepEqual(restored.turns[0].view, correctedView);
  const replay = await finishTurn({
    userId: "user",
    sessionId: session.sessionId,
    turnId: turn.turnId,
    status: "completed",
    messages,
    view: correctedView,
    error: null,
  });
  assert.equal(replay.alreadyCompleted, true);
  assert.deepEqual(replay.turn.view, correctedView);
  assert.equal(
    turn.view.events[0].result.data.airports.length,
    5,
    "Original stored projection was not mutated",
  );
});
