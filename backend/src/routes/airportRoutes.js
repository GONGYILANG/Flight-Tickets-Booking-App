import { Router } from "express";
import { search } from "../controllers/airportController.js";
import { validateAirportSearch } from "../validators/airportValidators.js";

const router = Router();

router.get("/search", validateAirportSearch, search);

export default router;
