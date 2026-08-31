import {
  cancelBooking,
  createBooking,
  getBookingForUser,
  listBookingsForUser,
} from "../services/bookingService.js";

export async function create(request, response) {
  const result = await createBooking({
    userId: request.user._id,
    ...request.validatedBody,
  });
  response.status(result.idempotentReplay ? 200 : 201).json({
    data: { booking: result.booking },
    meta: { idempotentReplay: result.idempotentReplay },
  });
}

export async function listMine(request, response) {
  const result = await listBookingsForUser({
    userId: request.user._id,
    ...request.validatedQuery,
  });
  response.status(200).json({ data: result });
}

export async function getMine(request, response) {
  const booking = await getBookingForUser({
    userId: request.user._id,
    bookingId: request.params.bookingId,
  });
  response.status(200).json({ data: { booking } });
}

export async function cancel(request, response) {
  const result = await cancelBooking({
    userId: request.user._id,
    bookingId: request.params.bookingId,
  });
  response.status(200).json({
    data: { booking: result.booking },
    meta: { alreadyCancelled: result.alreadyCancelled },
  });
}
