import { Router } from "express";
import { getById, search } from "../controllers/flightController.js";
import {
  validateFlightId,
  validateFlightSearch,
} from "../validators/flightValidators.js";

const router = Router();

router.get("/search", validateFlightSearch, search);
router.get("/:flightId", validateFlightId, getById);

export default router;
