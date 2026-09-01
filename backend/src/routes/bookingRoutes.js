import { Router } from "express";
import {
  cancelBooking,
  createBooking,
  getBookingForUser,
  listBookingsForUser,
} from "../services/bookingService.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  validateBookingId,
  validateCreateBooking,
  validateListBookings,
} from "../validators/bookingValidators.js";

const router = Router();

router.post("/", authenticate, validateCreateBooking, async (request, response) => {
  const result = await createBooking({
    userId: request.user._id,
    ...request.validatedBody,
  });
  response.status(result.idempotentReplay ? 200 : 201).json({
    data: { booking: result.booking },
    meta: { idempotentReplay: result.idempotentReplay },
  });
});
router.get("/me", authenticate, validateListBookings, async (request, response) => {
  response.json({
    data: await listBookingsForUser({
      userId: request.user._id,
      ...request.validatedQuery,
    }),
  });
});
router.get("/:bookingId", authenticate, validateBookingId, async (request, response) => {
  response.json({
    data: {
      booking: await getBookingForUser({
        userId: request.user._id,
        bookingId: request.params.bookingId,
      }),
    },
  });
});
router.patch(
  "/:bookingId/cancel",
  authenticate,
  validateBookingId,
  async (request, response) => {
    const result = await cancelBooking({
      userId: request.user._id,
      bookingId: request.params.bookingId,
    });
    response.json({
      data: { booking: result.booking },
      meta: { alreadyCancelled: result.alreadyCancelled },
    });
  },
);

export default router;
