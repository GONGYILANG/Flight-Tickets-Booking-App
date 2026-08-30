import { Router } from "express";
import {
  cancelBooking,
  getBooking,
  getUser,
  listBookings,
  listUsers,
  updateFlight,
  updateUserStatus,
} from "../controllers/adminController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  validateAdminBookingId,
  validateAdminBookingList,
  validateAdminCancellation,
  validateAdminFlightId,
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

router.patch(
  "/flights/:flightId",
  validateAdminFlightId,
  validateAdminFlightUpdate,
  updateFlight,
);

export default router;
