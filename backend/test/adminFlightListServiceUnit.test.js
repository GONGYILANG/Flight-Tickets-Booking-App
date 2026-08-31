import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import Airline from "../src/models/Airline.js";
import Airport from "../src/models/Airport.js";
import Flight from "../src/models/Flight.js";
import { listAdminFlights } from "../src/services/adminService.js";

function selectableLeanQuery(value) {
  return {
    select() {
      return this;
    },
    async lean() {
      return value;
    },
  };
}

test("admin flight list resolves reference filters and uses stable database sorting", async () => {
  const airline = {
    _id: new mongoose.Types.ObjectId(),
    code: "UT",
    name: "Unit Test Airline",
  };
  const origin = {
    _id: new mongoose.Types.ObjectId(),
    iataCode: "SIN",
    name: "Singapore Changi Airport",
    cityName: "Singapore",
    countryCode: "SG",
    timezone: "Asia/Singapore",
  };
  const destination = {
    _id: new mongoose.Types.ObjectId(),
    iataCode: "HKG",
    name: "Hong Kong International Airport",
    cityName: "Hong Kong",
    countryCode: "HK",
    timezone: "Asia/Hong_Kong",
  };
  const departureAt = new Date("2099-01-15T01:00:00.000Z");
  const flight = {
    _id: new mongoose.Types.ObjectId(),
    flightNumber: "UT100",
    airline,
    originAirport: origin,
    destinationAirport: destination,
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 4 * 60 * 60 * 1000),
    scheduledDepartureAt: departureAt,
    scheduledArrivalAt: new Date(
      departureAt.getTime() + 4 * 60 * 60 * 1000,
    ),
    priceCents: 30000,
    totalSeats: 100,
    availableSeats: 80,
    status: "SCHEDULED",
    scheduleVersion: 0,
  };
  const originalAirlineFindOne = Airline.findOne;
  const originalAirportFind = Airport.find;
  const originalFlightFind = Flight.find;
  const originalFlightCount = Flight.countDocuments;
  let receivedFilter;
  let receivedSort;

  Airline.findOne = () => selectableLeanQuery(airline);
  Airport.find = () => selectableLeanQuery([origin, destination]);
  Flight.find = (filter) => {
    receivedFilter = filter;
    return {
      sort(sort) {
        receivedSort = sort;
        return this;
      },
      skip() {
        return this;
      },
      limit() {
        return this;
      },
      populate() {
        return this;
      },
      async lean() {
        return [flight];
      },
    };
  };
  Flight.countDocuments = async () => 1;

  try {
    const result = await listAdminFlights({
      flightNumber: "UT100",
      airlineCode: "UT",
      origin: "SIN",
      destination: "HKG",
      status: "SCHEDULED",
      departureFrom: new Date("2099-01-01T00:00:00.000Z"),
      departureTo: new Date("2099-01-31T23:59:59.999Z"),
      page: 1,
      limit: 20,
      sortBy: "price",
      sortOrder: "desc",
    });

    assert.equal(receivedFilter.flightNumber, "UT100");
    assert.ok(receivedFilter.airline.equals(airline._id));
    assert.ok(receivedFilter.originAirport.equals(origin._id));
    assert.ok(receivedFilter.destinationAirport.equals(destination._id));
    assert.deepEqual(receivedSort, { priceCents: -1, _id: -1 });
    assert.equal(result.flights[0].id, flight._id.toString());
    assert.equal(result.flights[0].scheduleVersion, 0);
    assert.equal(result.pagination.totalItems, 1);
  } finally {
    Airline.findOne = originalAirlineFindOne;
    Airport.find = originalAirportFind;
    Flight.find = originalFlightFind;
    Flight.countDocuments = originalFlightCount;
  }
});
