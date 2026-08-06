import Airport from "../models/Airport.js";

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toAirportResponse(airport) {
  return {
    id: airport._id.toString(),
    iataCode: airport.iataCode,
    name: airport.name,
    cityName: airport.cityName,
    countryCode: airport.countryCode,
    timezone: airport.timezone,
  };
}

export async function searchAirports({ query, limit }) {
  const escapedQuery = escapeRegularExpression(query);
  const containsQuery = new RegExp(escapedQuery, "i");
  const prefixQuery = `^${escapedQuery}`;

  const airports = await Airport.aggregate([
    {
      $match: {
        $or: [
          { iataCode: containsQuery },
          { name: containsQuery },
          { cityName: containsQuery },
        ],
      },
    },
    {
      $addFields: {
        searchRank: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$iataCode", query.toUpperCase()] },
                then: 0,
              },
              {
                case: {
                  $regexMatch: {
                    input: "$iataCode",
                    regex: prefixQuery,
                    options: "i",
                  },
                },
                then: 1,
              },
              {
                case: {
                  $eq: [{ $toLower: "$cityName" }, query.toLowerCase()],
                },
                then: 2,
              },
              {
                case: {
                  $regexMatch: {
                    input: "$cityName",
                    regex: prefixQuery,
                    options: "i",
                  },
                },
                then: 3,
              },
              {
                case: {
                  $regexMatch: {
                    input: "$name",
                    regex: prefixQuery,
                    options: "i",
                  },
                },
                then: 4,
              },
            ],
            default: 5,
          },
        },
      },
    },
    { $sort: { searchRank: 1, cityName: 1, name: 1, iataCode: 1, _id: 1 } },
    { $limit: limit },
    {
      $project: {
        iataCode: 1,
        name: 1,
        cityName: 1,
        countryCode: 1,
        timezone: 1,
      },
    },
  ]);

  return airports.map(toAirportResponse);
}
