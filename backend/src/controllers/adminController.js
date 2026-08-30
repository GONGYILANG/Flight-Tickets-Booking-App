import {
  cancelAdminBooking,
  getAdminBooking,
  getAdminUser,
  listAdminBookings,
  listAdminUsers,
  updateAdminFlight,
  updateAdminUserStatus,
} from "../services/adminService.js";

export async function listUsers(request, response) {
  const result = await listAdminUsers(request.validatedQuery);
  response.status(200).json({ data: result });
}

export async function getUser(request, response) {
  const result = await getAdminUser(request.params.userId);
  response.status(200).json({ data: result });
}

export async function updateUserStatus(request, response) {
  const result = await updateAdminUserStatus({
    actorId: request.user._id,
    userId: request.params.userId,
    ...request.validatedBody,
  });
  response.status(200).json({
    data: { user: result.user },
    meta: { changed: result.changed },
  });
}

export async function listBookings(request, response) {
  const result = await listAdminBookings(request.validatedQuery);
  response.status(200).json({ data: result });
}

export async function getBooking(request, response) {
  const booking = await getAdminBooking(request.params.bookingId);
  response.status(200).json({ data: { booking } });
}

export async function cancelBooking(request, response) {
  const result = await cancelAdminBooking({
    actorId: request.user._id,
    bookingId: request.params.bookingId,
    ...request.validatedBody,
  });
  response.status(200).json({
    data: { booking: result.booking },
    meta: { alreadyCancelled: result.alreadyCancelled },
  });
}

export async function updateFlight(request, response) {
  const result = await updateAdminFlight({
    actorId: request.user._id,
    flightId: request.params.flightId,
    update: request.validatedBody,
  });
  response.status(200).json({
    data: { flight: result.flight },
    meta: {
      changed: result.changed,
      changedFields: result.changedFields,
      affectedBookings: result.affectedBookings,
    },
  });
}
