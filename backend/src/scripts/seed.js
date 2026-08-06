import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import Airline from "../models/Airline.js";
import Airport from "../models/Airport.js";
import Booking from "../models/Booking.js";
import Flight from "../models/Flight.js";
import User from "../models/User.js";

const airlineSeeds = [
  { code: "CX", name: "Cathay Pacific", active: true },
  { code: "HX", name: "Hong Kong Airlines", active: true },
  { code: "CA", name: "Air China", active: true },
];

const airportSeeds = [
  {
    iataCode: "PEK",
    name: "Beijing Capital International Airport",
    cityName: "Beijing",
    countryCode: "CN",
    timezone: "Asia/Shanghai",
  },
  {
    iataCode: "PKX",
    name: "Beijing Daxing International Airport",
    cityName: "Beijing",
    countryCode: "CN",
    timezone: "Asia/Shanghai",
  },
  {
    iataCode: "HKG",
    name: "Hong Kong International Airport",
    cityName: "Hong Kong",
    countryCode: "HK",
    timezone: "Asia/Hong_Kong",
  },
  {
    iataCode: "PVG",
    name: "Shanghai Pudong International Airport",
    cityName: "Shanghai",
    countryCode: "CN",
    timezone: "Asia/Shanghai",
  },
];

const flightSeeds = [
  {
    airlineCode: "CX",
    flightNumber: "CX101",
    origin: "PEK",
    destination: "HKG",
    departureAt: "2026-12-08T01:00:00.000Z",
    arrivalAt: "2026-12-08T04:45:00.000Z",
    totalSeats: 120,
  },
  {
    airlineCode: "CA",
    flightNumber: "CA115",
    origin: "PEK",
    destination: "HKG",
    departureAt: "2026-12-08T02:30:00.000Z",
    arrivalAt: "2026-12-08T06:10:00.000Z",
    totalSeats: 150,
  },
  {
    airlineCode: "HX",
    flightNumber: "HX313",
    origin: "PKX",
    destination: "HKG",
    departureAt: "2026-12-08T04:00:00.000Z",
    arrivalAt: "2026-12-08T07:50:00.000Z",
    totalSeats: 100,
  },
  {
    airlineCode: "CX",
    flightNumber: "CX102",
    origin: "HKG",
    destination: "PEK",
    departureAt: "2026-12-12T01:15:00.000Z",
    arrivalAt: "2026-12-12T04:45:00.000Z",
    totalSeats: 120,
  },
  {
    airlineCode: "CA",
    flightNumber: "CA116",
    origin: "HKG",
    destination: "PEK",
    departureAt: "2026-12-12T03:20:00.000Z",
    arrivalAt: "2026-12-12T07:00:00.000Z",
    totalSeats: 150,
  },
  {
    airlineCode: "CX",
    flightNumber: "CX368",
    origin: "HKG",
    destination: "PVG",
    departureAt: "2026-12-10T00:50:00.000Z",
    arrivalAt: "2026-12-10T03:30:00.000Z",
    totalSeats: 110,
  },
];

async function upsertReferences() {
  const airlines = new Map();
  const airports = new Map();

  for (const seed of airlineSeeds) {
    const airline = await Airline.findOneAndUpdate(
      { code: seed.code },
      { $set: seed },
      { upsert: true, new: true, runValidators: true },
    );
    airlines.set(airline.code, airline);
  }

  for (const seed of airportSeeds) {
    const airport = await Airport.findOneAndUpdate(
      { iataCode: seed.iataCode },
      { $set: seed },
      { upsert: true, new: true, runValidators: true },
    );
    airports.set(airport.iataCode, airport);
  }

  return { airlines, airports };
}

async function upsertFlights(airlines, airports) {
  for (const seed of flightSeeds) {
    const airline = airlines.get(seed.airlineCode);
    const originAirport = airports.get(seed.origin);
    const destinationAirport = airports.get(seed.destination);
    const departureAt = new Date(seed.departureAt);

    await Flight.updateOne(
      {
        airline: airline._id,
        flightNumber: seed.flightNumber,
        departureAt,
      },
      {
        $setOnInsert: {
          airline: airline._id,
          flightNumber: seed.flightNumber,
          originAirport: originAirport._id,
          destinationAirport: destinationAirport._id,
          departureAt,
          arrivalAt: new Date(seed.arrivalAt),
          totalSeats: seed.totalSeats,
          availableSeats: seed.totalSeats,
          status: "SCHEDULED",
        },
      },
      {
        upsert: true,
        runValidators: true,
      },
    );
  }
}

async function seed() {
  await connectDatabase();

  await Promise.all([
    User.init(),
    Airline.init(),
    Airport.init(),
    Flight.init(),
    Booking.init(),
  ]);

  const { airlines, airports } = await upsertReferences();
  await upsertFlights(airlines, airports);

  const [airlineCount, airportCount, flightCount] = await Promise.all([
    Airline.countDocuments(),
    Airport.countDocuments(),
    Flight.countDocuments(),
  ]);

  console.log(
    `Seed complete: ${airlineCount} airlines, ${airportCount} airports, ${flightCount} flights`,
  );
}

try {
  await seed();
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
