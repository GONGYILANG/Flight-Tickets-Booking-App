import { Router } from "express";
import { searchAirports } from "../services/airportService.js";
import { validateAirportSearch } from "../validators/airportValidators.js";

const router = Router();

router.get("/search", validateAirportSearch, async (request, response) => {
  const airports = await searchAirports(request.validatedQuery);
  response.json({ data: { airports } });
});

export default router;
