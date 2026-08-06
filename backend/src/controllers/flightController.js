import {
  getFlightById,
  searchFlights,
} from "../services/flightService.js";

export async function search(request, response) {
  const result = await searchFlights(request.validatedQuery);
  response.status(200).json({ data: result });
}

export async function getById(request, response) {
  const flight = await getFlightById(request.params.flightId);
  response.status(200).json({ data: { flight } });
}
