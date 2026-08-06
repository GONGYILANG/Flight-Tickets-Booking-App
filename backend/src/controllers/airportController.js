import { searchAirports } from "../services/airportService.js";

export async function search(request, response) {
  const airports = await searchAirports(request.validatedQuery);
  response.status(200).json({ data: { airports } });
}
