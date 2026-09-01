import { DateTime, IANAZone } from "luxon";
import { invalidRequest, serviceError } from "../errors.js";
import Airline from "../models/Airline.js";
import Airport from "../models/Airport.js";
import Flight from "../models/Flight.js";

export const bookableFlightStatuses = ["SCHEDULED", "DELAYED"];
export const flightPopulate = [
  { path: "airline", select: "code name" },
  {
    path: "originAirport",
    select: "iataCode name cityName countryCode timezone",
  },
  {
    path: "destinationAirport",
    select: "iataCode name cityName countryCode timezone",
  },
];

function safeReference(document, fields) {
  if (!document) {
    return null;
  }

  return fields.reduce(
    (result, field) => {
      result[field] = document[field];
      return result;
    },
    { id: document._id.toString() },
  );
}

export function formatUsdAmount(priceCents) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 1) {
    throw serviceError(
      "INVALID_FLIGHT_PRICE",
      "Flight has an invalid stored price",
      500,
    );
  }

  const cents = BigInt(priceCents);
  const dollars = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, "0");
  return `${dollars}.${remainder}`;
}

export function toFlightResponse(flight) {
  const departureAt = new Date(flight.departureAt);
  const arrivalAt = new Date(flight.arrivalAt);
  const scheduledDepartureAt = new Date(
    flight.scheduledDepartureAt ?? flight.departureAt,
  );
  const scheduledArrivalAt = new Date(
    flight.scheduledArrivalAt ?? flight.arrivalAt,
  );

  return {
    id: flight._id.toString(),
    flightNumber: flight.flightNumber,
    airline: safeReference(flight.airline, ["code", "name"]),
    originAirport: safeReference(flight.originAirport, [
      "iataCode",
      "name",
      "cityName",
      "countryCode",
      "timezone",
    ]),
    destinationAirport: safeReference(flight.destinationAirport, [
      "iataCode",
      "name",
      "cityName",
      "countryCode",
      "timezone",
    ]),
    departureAt: departureAt.toISOString(),
    arrivalAt: arrivalAt.toISOString(),
    scheduledDepartureAt: scheduledDepartureAt.toISOString(),
    scheduledArrivalAt: scheduledArrivalAt.toISOString(),
    scheduleChanged:
      departureAt.getTime() !== scheduledDepartureAt.getTime() ||
      arrivalAt.getTime() !== scheduledArrivalAt.getTime(),
    durationMinutes: Math.round(
      (arrivalAt.getTime() - departureAt.getTime()) / 60000,
    ),
    price: {
      amount: formatUsdAmount(flight.priceCents),
      currency: "USD",
    },
    totalSeats: flight.totalSeats,
    availableSeats: flight.availableSeats,
    status: flight.status,
  };
}

function toSearchMetadata(criteria, departureTimezone) {
  return {
    origin: criteria.origin,
    destination: criteria.destination,
    departureDate: criteria.departureDate,
    departurePeriod: criteria.departurePeriod,
    departureTimezone,
    airlineCode: criteria.airlineCode,
    passengers: criteria.passengers,
    sortBy: criteria.sortBy,
    sortOrder: criteria.sortOrder,
  };
}

export function getDepartureWindow(
  criteria,
  timezone,
  currentTime = new Date(),
) {
  if (typeof timezone !== "string" || !IANAZone.isValidZone(timezone)) {
    throw serviceError(
      "INVALID_AIRPORT_TIMEZONE",
      `Origin airport has an invalid timezone: ${timezone}`,
      500,
    );
  }

  const localDayStart = DateTime.fromISO(criteria.departureDate, {
    zone: timezone,
  }).startOf("day");

  if (!localDayStart.isValid) {
    throw serviceError(
      "INVALID_AIRPORT_TIMEZONE",
      `Origin airport has an invalid timezone: ${timezone}`,
      500,
    );
  }

  const currentInstant = new Date(currentTime);
  if (Number.isNaN(currentInstant.getTime())) {
    throw serviceError(
      "INVALID_CURRENT_TIME",
      "Current time is invalid",
      500,
    );
  }

  const now = DateTime.fromJSDate(currentInstant, { zone: timezone });
  const localNoon = localDayStart.set({ hour: 12 });
  const localNextDayStart = localDayStart.plus({ days: 1 });

  let requestedStart = localDayStart;
  let requestedEnd = localNextDayStart;

  if (criteria.departurePeriod === "MORNING") {
    requestedEnd = localNoon;
  } else if (criteria.departurePeriod === "AFTERNOON") {
    requestedStart = localNoon;
  }

  if (now.toMillis() >= requestedEnd.toMillis()) {
    return {
      start: currentInstant,
      end: currentInstant,
    };
  }

  const effectiveStart =
    now.toMillis() > requestedStart.toMillis() ? now : requestedStart;

  return {
    start: effectiveStart.toUTC().toJSDate(),
    end: requestedEnd.toUTC().toJSDate(),
  };
}

export async function searchFlights(criteria) {
  const [airports, airline] = await Promise.all([
    Airport.find({
      iataCode: { $in: [criteria.origin, criteria.destination] },
    })
      .select("iataCode timezone")
      .lean(),
    criteria.airlineCode
      ? Airline.findOne({ code: criteria.airlineCode, active: true })
          .select("_id code")
          .lean()
      : Promise.resolve(null),
  ]);

  const airportByCode = new Map(
    airports.map((airport) => [airport.iataCode, airport]),
  );
  const originAirport = airportByCode.get(criteria.origin);
  const destinationAirport = airportByCode.get(criteria.destination);

  const invalidFields = [];
  if (!originAirport) {
    invalidFields.push({
      field: "origin",
      message: "origin must identify an existing airport",
    });
  }
  if (!destinationAirport) {
    invalidFields.push({
      field: "destination",
      message: "destination must identify an existing airport",
    });
  }
  if (criteria.airlineCode && !airline) {
    invalidFields.push({
      field: "airlineCode",
      message: "airlineCode must identify an active airline",
    });
  }
  if (invalidFields.length > 0) {
    throw invalidRequest(
      invalidFields,
      "One or more request parameters are invalid",
    );
  }

  const currentTime = new Date();
  const departureWindow = getDepartureWindow(
    criteria,
    originAirport.timezone,
    currentTime,
  );

  const filter = {
    originAirport: originAirport._id,
    destinationAirport: destinationAirport._id,
    departureAt: {
      $gte: departureWindow.start,
      $gt: currentTime,
      $lt: departureWindow.end,
    },
    availableSeats: { $gte: criteria.passengers },
    status: { $in: bookableFlightStatuses },
  };
  if (airline) {
    filter.airline = airline._id;
  }

  const direction = criteria.sortOrder === "asc" ? 1 : -1;
  const skip = (criteria.page - 1) * criteria.limit;
  const sortField =
    criteria.sortBy === "price" ? "priceCents" : criteria.sortBy;
  const sort = { [sortField]: direction, _id: direction };

  const [matchingFlights, totalItems] = await Promise.all([
    Flight.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(criteria.limit)
      .populate(flightPopulate)
      .lean(),
    Flight.countDocuments(filter),
  ]);

  return {
    flights: matchingFlights.map(toFlightResponse),
    pagination: {
      page: criteria.page,
      limit: criteria.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / criteria.limit),
    },
    search: toSearchMetadata(criteria, originAirport.timezone),
  };
}

export async function getFlightById(flightId) {
  const flight = await Flight.findById(flightId)
    .populate(flightPopulate)
    .lean();

  if (!flight) {
    throw serviceError("FLIGHT_NOT_FOUND", "Flight was not found", 404);
  }

  return toFlightResponse(flight);
}
