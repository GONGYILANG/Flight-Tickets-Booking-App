import { Router } from "express";
import { serviceError } from "../errors.js";
import {
  cancelAdminBooking,
  getAdminBooking,
  getAdminFlight,
  getAdminUser,
  listAdminBookings,
  listAdminFlights,
  listAdminUsers,
  updateAdminFlight,
  updateAdminFlightSchedule,
  updateAdminUserStatus,
} from "../services/adminService.js";
import { authenticate } from "../middleware/authenticate.js";
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

router.use(authenticate, (request, _response, next) => {
  if (request.user.role === "ADMIN") {
    return next();
  }
  return next(
    serviceError("ADMIN_REQUIRED", "Administrator access is required", 403),
  );
});

router.get("/users", validateAdminUserList, async (request, response) => {
  response.json({ data: await listAdminUsers(request.validatedQuery) });
});
router.get("/users/:userId", validateAdminUserId, async (request, response) => {
  response.json({ data: await getAdminUser(request.params.userId) });
});
router.patch(
  "/users/:userId/status",
  validateAdminUserId,
  validateAdminUserStatus,
  async (request, response) => {
    const result = await updateAdminUserStatus({
      actorId: request.user._id,
      userId: request.params.userId,
      ...request.validatedBody,
    });
    response.json({
      data: { user: result.user },
      meta: { changed: result.changed },
    });
  },
);

router.get("/bookings", validateAdminBookingList, async (request, response) => {
  response.json({ data: await listAdminBookings(request.validatedQuery) });
});
router.get("/bookings/:bookingId", validateAdminBookingId, async (request, response) => {
  response.json({
    data: { booking: await getAdminBooking(request.params.bookingId) },
  });
});
router.patch(
  "/bookings/:bookingId/cancel",
  validateAdminBookingId,
  validateAdminCancellation,
  async (request, response) => {
    const result = await cancelAdminBooking({
      actorId: request.user._id,
      bookingId: request.params.bookingId,
      ...request.validatedBody,
    });
    response.json({
      data: { booking: result.booking },
      meta: { alreadyCancelled: result.alreadyCancelled },
    });
  },
);

router.get("/flights", validateAdminFlightList, async (request, response) => {
  response.json({ data: await listAdminFlights(request.validatedQuery) });
});
router.get("/flights/:flightId", validateAdminFlightId, async (request, response) => {
  response.json({
    data: { flight: await getAdminFlight(request.params.flightId) },
  });
});
router.patch(
  "/flights/:flightId/schedule",
  validateAdminFlightId,
  validateAdminFlightSchedule,
  async (request, response) => {
    const result = await updateAdminFlightSchedule({
      actorId: request.user._id,
      flightId: request.params.flightId,
      ...request.validatedBody,
    });
    response.json({
      data: { flight: result.flight },
      meta: {
        changed: result.changed,
        changedFields: result.changedFields,
        affectedBookings: result.affectedBookings,
      },
    });
  },
);
router.patch(
  "/flights/:flightId",
  validateAdminFlightId,
  validateAdminFlightUpdate,
  async (request, response) => {
    const result = await updateAdminFlight({
      actorId: request.user._id,
      flightId: request.params.flightId,
      update: request.validatedBody,
    });
    response.json({
      data: { flight: result.flight },
      meta: {
        changed: result.changed,
        changedFields: result.changedFields,
        affectedBookings: result.affectedBookings,
      },
    });
  },
);

export default router;
