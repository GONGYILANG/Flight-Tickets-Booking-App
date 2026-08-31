import { Router } from "express";
import {
  cancelBooking,
  getBooking,
  getFlight,
  getUser,
  listBookings,
  listFlights,
  listUsers,
  updateFlight,
  updateFlightSchedule,
  updateUserStatus,
} from "../controllers/adminController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  validateAdminBookingId,
  validateAdminBookingList,
  validateAdminCancellation,
  validateAdminFlightId,
  validateAdminFlightList,
  validateAdminFlightSchedule,
  validateAdminFlightUpdate,
  validateAdminUserId,
  validateAdminUserList,
  validateAdminUserStatus,
} from "../validators/adminValidators.js";

const router = Router();

router.use(authenticate, requireAdmin);

router.get("/users", validateAdminUserList, listUsers);
router.get("/users/:userId", validateAdminUserId, getUser);
router.patch(
  "/users/:userId/status",
  validateAdminUserId,
  validateAdminUserStatus,
  updateUserStatus,
);

router.get("/bookings", validateAdminBookingList, listBookings);
router.get("/bookings/:bookingId", validateAdminBookingId, getBooking);
router.patch(
  "/bookings/:bookingId/cancel",
  validateAdminBookingId,
  validateAdminCancellation,
  cancelBooking,
);

router.get("/flights", validateAdminFlightList, listFlights);
router.get("/flights/:flightId", validateAdminFlightId, getFlight);
router.patch(
  "/flights/:flightId/schedule",
  validateAdminFlightId,
  validateAdminFlightSchedule,
  updateFlightSchedule,
);
router.patch(
  "/flights/:flightId",
  validateAdminFlightId,
  validateAdminFlightUpdate,
  updateFlight,
);

export default router;
