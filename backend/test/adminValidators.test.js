import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateAdminBookingList,
  validateAdminCancellation,
  validateAdminFlightUpdate,
  validateAdminUserList,
  validateAdminUserStatus,
} from "../src/validators/adminValidators.js";

function runValidator(validator, request) {
  return new Promise((resolve, reject) => {
    validator(request, {}, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(request);
      }
    });
  });
}

async function validationError(validator, request) {
  try {
    await runValidator(validator, request);
  } catch (error) {
    return error;
  }
  assert.fail("Expected validation to fail");
}

test("admin user list normalizes filters and pagination", async () => {
  const request = await runValidator(validateAdminUserList, {
    query: { q: "  EXAMPLE  ", status: "active", role: "admin", page: "2" },
  });
  assert.deepEqual(request.validatedQuery, {
    query: "EXAMPLE",
    status: "ACTIVE",
    role: "ADMIN",
    page: 2,
    limit: 20,
  });
});

test("administrator reasons are mandatory and trimmed", async () => {
  const missing = await validationError(validateAdminUserStatus, {
    body: { status: "LOCKED" },
  });
  assert.equal(missing.code, "ADMIN_REASON_REQUIRED");

  const request = await runValidator(validateAdminCancellation, {
    body: { reason: "  Customer support request  " },
  });
  assert.equal(request.validatedBody.reason, "Customer support request");
});

test("admin booking list validates identifiers and date ranges", async () => {
  const error = await validationError(validateAdminBookingList, {
    query: {
      userId: "not-an-id",
      createdFrom: "2026-08-28T00:00:00.000Z",
      createdTo: "2026-08-27T00:00:00.000Z",
    },
  });
  assert.equal(error.code, "INVALID_REQUEST");
  assert.deepEqual(
    error.details.fields.map(({ field }) => field),
    ["userId", "createdTo"],
  );
});

test("flight update accepts price-only changes without a reason", async () => {
  const request = await runValidator(validateAdminFlightUpdate, {
    body: { priceCents: 42000 },
  });
  assert.deepEqual(request.validatedBody, {
    hasStatus: false,
    hasPriceCents: true,
    status: null,
    priceCents: 42000,
    reason: null,
  });
});

test("flight update rejects unknown fields and status changes without reasons", async () => {
  const unknown = await validationError(validateAdminFlightUpdate, {
    body: { totalSeats: 100 },
  });
  assert.equal(unknown.code, "INVALID_REQUEST");
  assert.deepEqual(
    unknown.details.fields.map(({ field }) => field),
    ["totalSeats", "body"],
  );

  const missingReason = await validationError(validateAdminFlightUpdate, {
    body: { status: "DELAYED" },
  });
  assert.equal(missingReason.code, "ADMIN_REASON_REQUIRED");
});
