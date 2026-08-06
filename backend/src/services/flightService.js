import "../models/Airline.js";
import Airport from "../models/Airport.js";
import Flight from "../models/Flight.js";

const flightPopulate = [
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

function serviceError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

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

export function toFlightResponse(flight) {
  const departureAt = new Date(flight.departureAt);
  const arrivalAt = new Date(flight.arrivalAt);

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
    durationMinutes: Math.round(
      (arrivalAt.getTime() - departureAt.getTime()) / 60000,
    ),
    totalSeats: flight.totalSeats,
    availableSeats: flight.availableSeats,
    status: flight.status,
  };
}

function emptySearchResult(criteria) {
  return {
    flights: [],
    pagination: {
      page: criteria.page,
      limit: criteria.limit,
      totalItems: 0,
      totalPages: 0,
    },
    search: {
      origin: criteria.origin,
      destination: criteria.destination,
      departureDate: criteria.departureDate,
      passengers: criteria.passengers,
      sortBy: criteria.sortBy,
      sortOrder: criteria.sortOrder,
    },
  };
}

export async function searchFlights(criteria) {
  const airports = await Airport.find({
    iataCode: { $in: [criteria.origin, criteria.destination] },
  })
    .select("iataCode")
    .lean();

  const airportByCode = new Map(
    airports.map((airport) => [airport.iataCode, airport]),
  );
  const originAirport = airportByCode.get(criteria.origin);
  const destinationAirport = airportByCode.get(criteria.destination);

  if (!originAirport || !destinationAirport) {
    return emptySearchResult(criteria);
  }

  const dayStart = new Date(`${criteria.departureDate}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const filter = {
    originAirport: originAirport._id,
    destinationAirport: destinationAirport._id,
    departureAt: { $gte: dayStart, $lt: dayEnd },
    availableSeats: { $gte: criteria.passengers },
    status: { $in: ["SCHEDULED", "DELAYED"] },
  };
  const direction = criteria.sortOrder === "asc" ? 1 : -1;
  const skip = (criteria.page - 1) * criteria.limit;

  const matchingFlights = await Flight.find(filter)
    .populate(flightPopulate)
    .lean();

  matchingFlights.sort((first, second) => {
    const firstValue = ["departureAt", "arrivalAt"].includes(criteria.sortBy)
      ? new Date(first[criteria.sortBy]).getTime()
      : first[criteria.sortBy];
    const secondValue = ["departureAt", "arrivalAt"].includes(criteria.sortBy)
      ? new Date(second[criteria.sortBy]).getTime()
      : second[criteria.sortBy];

    if (firstValue === secondValue) {
      return first._id.toString().localeCompare(second._id.toString());
    }
    return (firstValue < secondValue ? -1 : 1) * direction;
  });

  const totalItems = matchingFlights.length;
  const flights = matchingFlights.slice(skip, skip + criteria.limit);

  return {
    flights: flights.map(toFlightResponse),
    pagination: {
      page: criteria.page,
      limit: criteria.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / criteria.limit),
    },
    search: {
      origin: criteria.origin,
      destination: criteria.destination,
      departureDate: criteria.departureDate,
      passengers: criteria.passengers,
      sortBy: criteria.sortBy,
      sortOrder: criteria.sortOrder,
    },
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
