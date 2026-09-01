import { Router } from "express";
import {
  getFlightById,
  searchFlights,
} from "../services/flightService.js";
import {
  validateFlightId,
  validateFlightSearch,
} from "../validators/flightValidators.js";

const router = Router();

router.get("/search", validateFlightSearch, async (request, response) => {
  response.json({ data: await searchFlights(request.validatedQuery) });
});
router.get("/:flightId", validateFlightId, async (request, response) => {
  response.json({
    data: { flight: await getFlightById(request.params.flightId) },
  });
});

export default router;
