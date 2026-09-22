import type {
  Airport,
  Booking,
  ChatEvent,
  ChatSession,
  ChatSessionSummary,
  Flight,
  FlightSearchParams,
  Pagination,
  User,
} from './types'
import { toQueryParams } from './lib.ts'

let accessToken: string | null = null
let unauthorizedHandler: (() => void) | null = null

export class ApiError extends Error {
  status: number
  code: string
  fields: Array<{ field: string; message: string }>

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Array<{ field: string; message: string }> = [],
  ) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const requestToken = accessToken
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (authenticated && accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the service. Please try again.')
  }

  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = body.error ?? body.detail ?? {}
    if (
      authenticated &&
      requestToken === accessToken &&
      (response.status === 401 || error.code === 'ACCOUNT_NOT_ACTIVE')
    )
      unauthorizedHandler?.()
    throw new ApiError(
      response.status,
      error.code ?? 'REQUEST_FAILED',
      error.message ?? 'The request could not be completed.',
      error.details?.fields ?? [],
    )
  }
  return body as T
}

export async function getHealth() {
  return request<{ status: string }>('/api/health')
}

export async function login(email: string, password: string) {
  const response = await request<{ data: { user: User; accessToken: string; expiresIn: string } }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
  return response.data
}

export async function register(displayName: string, email: string, password: string) {
  const response = await request<{ data: { user: User; accessToken: string; expiresIn: string } }>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify({ displayName, email, password }) },
  )
  return response.data
}

export async function getMe() {
  return (await request<{ data: { user: User } }>('/api/auth/me', {}, true)).data.user
}

export async function logout() {
  await request<void>('/api/auth/logout', { method: 'POST' }, true)
}

export async function listAirlines(signal?: AbortSignal) {
  return (
    await request<{ data: { airlines: Array<{ code: string; name: string }> } }>('/api/airlines', {
      signal,
    })
  ).data.airlines
}

export async function searchAirports(value: string, limit = 10, signal?: AbortSignal) {
  const response = await request<{ data: { airports: Airport[] } }>(
    `/api/airports/search?${toQueryParams({ q: value, limit })}`,
    { signal },
  )
  return response.data.airports
}

export async function searchFlights(values: FlightSearchParams, signal?: AbortSignal) {
  const response = await request<{
    data: {
      flights: Flight[]
      pagination: Pagination
      search: FlightSearchParams & { departureTimezone: string }
    }
  }>(`/api/flights/search?${toQueryParams({ ...values })}`, { signal })
  return response.data
}

export async function getFlight(flightId: string, signal?: AbortSignal) {
  return (
    await request<{ data: { flight: Flight } }>(`/api/flights/${encodeURIComponent(flightId)}`, {
      signal,
    })
  ).data.flight
}

export async function createBooking(flightId: string, seatCount: number, idempotencyKey: string) {
  const response = await request<{
    data: { booking: Booking }
    meta: { idempotentReplay: boolean }
  }>(
    '/api/bookings',
    { method: 'POST', body: JSON.stringify({ flightId, seatCount, source: 'UI', idempotencyKey }) },
    true,
  )
  return { booking: response.data.booking, idempotentReplay: response.meta.idempotentReplay }
}

export async function listBookings(page = 1, limit = 20, signal?: AbortSignal) {
  return (
    await request<{ data: { bookings: Booking[]; pagination: Pagination } }>(
      `/api/bookings/me?${toQueryParams({ page, limit })}`,
      { signal },
      true,
    )
  ).data
}

export async function getBooking(bookingId: string, signal?: AbortSignal) {
  return (
    await request<{ data: { booking: Booking } }>(
      `/api/bookings/${encodeURIComponent(bookingId)}`,
      { signal },
      true,
    )
  ).data.booking
}

export async function cancelBooking(bookingId: string) {
  const response = await request<{
    data: { booking: Booking }
    meta: { alreadyCancelled: boolean }
  }>(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'PATCH', body: '{}' }, true)
  return { booking: response.data.booking, alreadyCancelled: response.meta.alreadyCancelled }
}

export async function sendChat(message: string, sessionId: string, requestId: string) {
  return request<{
    sessionId: string
    requestId: string
    message: string
    replayed: boolean
    events: ChatEvent[]
  }>(
    '/chat-api/chat',
    { method: 'POST', body: JSON.stringify({ message, sessionId, requestId }) },
    true,
  )
}

export async function listChatSessions(signal?: AbortSignal) {
  return (
    await request<{ data: { sessions: ChatSessionSummary[] } }>(
      '/chat-api/chat/sessions',
      { signal },
      true,
    )
  ).data.sessions
}

export async function getChatSession(sessionId: string, signal?: AbortSignal) {
  return (
    await request<{ data: { session: ChatSession } }>(
      `/chat-api/chat/sessions/${encodeURIComponent(sessionId)}`,
      { signal },
      true,
    )
  ).data.session
}

export async function deleteChat(sessionId: string) {
  return request<void>(
    `/chat-api/chat/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
    true,
  )
}
