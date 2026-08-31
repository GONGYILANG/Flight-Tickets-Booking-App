import { Router } from "express";
import {
  cancel,
  create,
  getMine,
  listMine,
} from "../controllers/bookingController.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  validateBookingId,
  validateCreateBooking,
  validateListBookings,
} from "../validators/bookingValidators.js";

const router = Router();

router.post("/", authenticate, validateCreateBooking, create);
router.get("/me", authenticate, validateListBookings, listMine);
router.get("/:bookingId", authenticate, validateBookingId, getMine);
router.patch(
  "/:bookingId/cancel",
  authenticate,
  validateBookingId,
  cancel,
);

export default router;
