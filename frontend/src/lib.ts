import type { Flight, FlightSearchParams } from './types'

export interface PendingBooking {
  flightId: string
  seatCount: number
  idempotencyKey: string
}

export function amountToCents(amount: string): number {
  if (!/^\d+\.\d{2}$/.test(amount)) throw new Error(`Invalid amount: ${amount}`)
  const [whole = '0', fraction = '00'] = amount.split('.')
  const cents = Number(whole) * 100 + Number(fraction)
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount is too large: ${amount}`)
  return cents
}

export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function formatMoney(amount: string, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(amountToCents(amount) / 100)
}

export function formatTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function formatFlightDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatShortDate(date: string): string {
  if (!isCalendarDate(date)) return 'Select a date'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`),
  )
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function boundedInteger(value: unknown, fallback: number, maximum: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= 1 && number <= maximum ? number : fallback
}

export function isBookable(flight: Flight, passengers: number, now = Date.now()): boolean {
  return Number.isInteger(passengers) && passengers >= 1 && passengers <= 9 &&
    flight.availableSeats >= passengers && ['SCHEDULED', 'DELAYED'].includes(flight.status) &&
    new Date(flight.departureAt).getTime() > now
}

export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function toQueryParams(values: Record<string, string | number | undefined>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params
}

export function toSearchParams(search: FlightSearchParams): URLSearchParams {
  return toQueryParams({
    origin: search.origin,
    destination: search.destination,
    departureDate: search.departureDate,
    passengers: search.passengers,
    page: search.page ?? 1,
    sortBy: search.sortBy ?? 'departureAt',
    sortOrder: search.sortOrder ?? 'asc',
    departurePeriod: search.departurePeriod,
    airlineCode: search.airlineCode,
  })
}

export function bookingAttempt(
  existing: PendingBooking | null,
  flightId: string,
  seatCount: number,
  createKey: () => string = () => crypto.randomUUID(),
): PendingBooking {
  if (existing?.flightId === flightId && existing.seatCount === seatCount) return existing
  return { flightId, seatCount, idempotencyKey: createKey() }
}
