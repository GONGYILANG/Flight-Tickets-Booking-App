import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";

const USD_CURRENCY = "USD";

export const KNOWN_FLIGHT_PRICES = Object.freeze([
  {
    flightNumber: "CX101",
    departureAt: "2026-12-08T01:00:00.000Z",
    priceCents: 38000,
  },
  {
    flightNumber: "CA115",
    departureAt: "2026-12-08T02:30:00.000Z",
    priceCents: 32500,
  },
  {
    flightNumber: "HX313",
    departureAt: "2026-12-08T04:00:00.000Z",
    priceCents: 29000,
  },
  {
    flightNumber: "CX102",
    departureAt: "2026-12-12T01:15:00.000Z",
    priceCents: 36500,
  },
  {
    flightNumber: "CA116",
    departureAt: "2026-12-12T03:20:00.000Z",
    priceCents: 31000,
  },
  {
    flightNumber: "CX368",
    departureAt: "2026-12-10T00:50:00.000Z",
    priceCents: 24000,
  },
]);

function normalizedFlightNumber(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizedDepartureAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function flightPriceKey(flightNumber, departureAt) {
  const normalizedDate = normalizedDepartureAt(departureAt);
  if (!normalizedDate) {
    return null;
  }
  return `${normalizedFlightNumber(flightNumber)}|${normalizedDate}`;
}

const knownPriceMap = new Map(
  KNOWN_FLIGHT_PRICES.map(({ flightNumber, departureAt, priceCents }) => [
    flightPriceKey(flightNumber, departureAt),
    priceCents,
  ]),
);

export function isValidPriceCents(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidSeatCount(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isValidPriceSnapshot(snapshot, seatCount) {
  if (!snapshot || !isValidSeatCount(seatCount)) {
    return false;
  }

  const { unitPriceCents, totalPriceCents, currency } = snapshot;
  return (
    currency === USD_CURRENCY &&
    isValidPriceCents(unitPriceCents) &&
    isValidPriceCents(totalPriceCents) &&
    Number.isSafeInteger(unitPriceCents * seatCount) &&
    totalPriceCents === unitPriceCents * seatCount
  );
}

function documentId(document) {
  return document?._id?.toString?.() ?? String(document?._id ?? "");
}

async function findLean(model, projection) {
  const query = model.find({}, projection);
  return typeof query?.lean === "function" ? query.lean() : query;
}

async function inspectPricing(FlightModel, BookingModel) {
  const [flights, bookings] = await Promise.all([
    findLean(FlightModel, "flightNumber departureAt priceCents"),
    findLean(BookingModel, "flight seatCount priceSnapshot"),
  ]);
  const flightById = new Map(flights.map((flight) => [documentId(flight), flight]));
  const effectivePriceByFlightId = new Map();
  const flightPriceRepairs = [];
  const unknownFlightPrices = [];

  for (const flight of flights) {
    const flightId = documentId(flight);
    if (isValidPriceCents(flight.priceCents)) {
      effectivePriceByFlightId.set(flightId, flight.priceCents);
      continue;
    }

    const departureAt = normalizedDepartureAt(flight.departureAt);
    const mappedPrice = knownPriceMap.get(
      flightPriceKey(flight.flightNumber, flight.departureAt),
    );
    const description = {
      flightId,
      flightNumber: normalizedFlightNumber(flight.flightNumber),
      departureAt,
      currentPriceCents: flight.priceCents ?? null,
    };

    if (!isValidPriceCents(mappedPrice)) {
      unknownFlightPrices.push(description);
      continue;
    }

    effectivePriceByFlightId.set(flightId, mappedPrice);
    flightPriceRepairs.push({ ...description, priceCents: mappedPrice });
  }

  const bookingSnapshotRepairs = [];
  const unrepairableBookings = [];
  for (const booking of bookings) {
    if (isValidPriceSnapshot(booking.priceSnapshot, booking.seatCount)) {
      continue;
    }

    const bookingId = documentId(booking);
    const flightId = booking.flight?.toString?.() ?? String(booking.flight ?? "");
    const flight = flightById.get(flightId);
    const unitPriceCents = effectivePriceByFlightId.get(flightId);
    const totalPriceCents = unitPriceCents * booking.seatCount;

    if (
      !flight ||
      !isValidSeatCount(booking.seatCount) ||
      !isValidPriceCents(unitPriceCents) ||
      !Number.isSafeInteger(totalPriceCents) ||
      totalPriceCents <= 0
    ) {
      unrepairableBookings.push({
        bookingId,
        flightId,
        seatCount: booking.seatCount ?? null,
        reason: !flight
          ? "FLIGHT_NOT_FOUND"
          : !isValidSeatCount(booking.seatCount)
            ? "INVALID_SEAT_COUNT"
            : "FLIGHT_PRICE_UNAVAILABLE",
      });
      continue;
    }

    bookingSnapshotRepairs.push({
      bookingId,
      flightId,
      priceSnapshot: {
        unitPriceCents,
        totalPriceCents,
        currency: USD_CURRENCY,
      },
    });
  }

  return {
    totals: { flights: flights.length, bookings: bookings.length },
    flightPriceRepairs,
    bookingSnapshotRepairs,
    unknownFlightPrices,
    unrepairableBookings,
  };
}

function reportForInspection(inspection, mode, finalVerification = null) {
  return {
    mode,
    totals: inspection.totals,
    issues: {
      invalidFlightPriceCount:
        inspection.flightPriceRepairs.length + inspection.unknownFlightPrices.length,
      invalidBookingSnapshotCount:
        inspection.bookingSnapshotRepairs.length +
        inspection.unrepairableBookings.length,
    },
    plannedRepairs: {
      flights: inspection.flightPriceRepairs,
      bookings: inspection.bookingSnapshotRepairs,
    },
    unresolved: {
      flights: inspection.unknownFlightPrices,
      bookings: inspection.unrepairableBookings,
    },
    finalVerification,
  };
}

export class PricingMigrationError extends Error {
  constructor(message, report = null, options = undefined) {
    super(message, options);
    this.name = "PricingMigrationError";
    this.report = report;
  }
}

function assertInspectionRepairable(inspection, report) {
  if (inspection.unknownFlightPrices.length > 0) {
    throw new PricingMigrationError(
      "Unknown flights have missing or invalid prices; add an explicit price mapping before retrying",
      report,
    );
  }
  if (inspection.unrepairableBookings.length > 0) {
    throw new PricingMigrationError(
      "Some Booking price snapshots cannot be derived from their related Flight",
      report,
    );
  }
}

export async function migratePricing({
  FlightModel = Flight,
  BookingModel = Booking,
  apply = false,
  bookingWritesPaused = process.env.BOOKING_WRITES_PAUSED === "true",
} = {}) {
  if (apply && !bookingWritesPaused) {
    throw new PricingMigrationError(
      "--apply requires BOOKING_WRITES_PAUSED=true and a maintenance window with Booking writes actually paused",
    );
  }

  const inspection = await inspectPricing(FlightModel, BookingModel);
  const mode = apply ? "APPLY" : "REPORT_ONLY";
  const initialReport = reportForInspection(inspection, mode);
  assertInspectionRepairable(inspection, initialReport);

  if (!apply) {
    return initialReport;
  }

  for (const repair of inspection.flightPriceRepairs) {
    const result = await FlightModel.updateOne(
      { _id: repair.flightId },
      { $set: { priceCents: repair.priceCents } },
      { runValidators: true },
    );
    if (result.matchedCount !== 1) {
      throw new PricingMigrationError(
        `Flight ${repair.flightId} disappeared during pricing migration; rerun after investigating`,
        initialReport,
      );
    }
  }

  for (const repair of inspection.bookingSnapshotRepairs) {
    const result = await BookingModel.updateOne(
      { _id: repair.bookingId },
      { $set: { priceSnapshot: repair.priceSnapshot } },
      { runValidators: true },
    );
    if (result.matchedCount !== 1) {
      throw new PricingMigrationError(
        `Booking ${repair.bookingId} disappeared during pricing migration; rerun after investigating`,
        initialReport,
      );
    }
  }

  const finalInspection = await inspectPricing(FlightModel, BookingModel);
  const finalVerification = {
    invalidFlightPriceCount:
      finalInspection.flightPriceRepairs.length +
      finalInspection.unknownFlightPrices.length,
    invalidBookingSnapshotCount:
      finalInspection.bookingSnapshotRepairs.length +
      finalInspection.unrepairableBookings.length,
  };
  const finalReport = reportForInspection(
    inspection,
    mode,
    finalVerification,
  );

  if (
    finalVerification.invalidFlightPriceCount !== 0 ||
    finalVerification.invalidBookingSnapshotCount !== 0
  ) {
    throw new PricingMigrationError(
      "Pricing migration finished writing but final verification failed; rerun after investigating",
      finalReport,
    );
  }

  return finalReport;
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function runCli() {
  const apply = process.argv.includes("--apply");
  const connection = await connectDatabase();
  const report = await migratePricing({ apply });
  console.log(
    JSON.stringify(
      {
        database: connection.name,
        ...report,
      },
      null,
      2,
    ),
  );
  if (!apply) {
    console.log(
      "No changes applied. Pause Booking writes, set BOOKING_WRITES_PAUSED=true, then rerun with --apply.",
    );
  }
}

if (isDirectExecution()) {
  try {
    await runCli();
  } catch (error) {
    if (error.report) {
      console.error(JSON.stringify(error.report, null, 2));
    }
    console.error("Pricing migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
