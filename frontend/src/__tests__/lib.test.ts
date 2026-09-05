import assert from 'node:assert/strict'
import test from 'node:test'

import { amountToCents, bookingAttempt, boundedInteger, centsToAmount, formatShortDate, formatTime, isBookable, isCalendarDate, shiftDate, toQueryParams, toSearchParams } from '../lib.ts'
import type { Flight } from '../types.ts'

test('money is calculated in integer cents', () => {
  assert.equal(amountToCents('380.00') * 2, 76000)
  assert.equal(centsToAmount(76000), '760.00')
  assert.throws(() => amountToCents('3.8'))
})

test('airport-local time formatting uses the supplied timezone', () => {
  assert.equal(formatTime('2026-12-08T00:30:00.000Z', 'Asia/Shanghai'), '08:30')
})

test('invalid URL dates and fractional traveler counts cannot crash or book', () => {
  assert.equal(isCalendarDate('2026-02-29'), false)
  assert.equal(isCalendarDate('2028-02-29'), true)
  assert.equal(formatShortDate('2026-99-99'), 'Select a date')
  assert.equal(formatShortDate('2026-12-08'), 'Tue, Dec 8')
  assert.equal(boundedInteger('1.5', 1, 9), 1)
  assert.equal(boundedInteger('2', 1, 9), 2)
  const flight = { status: 'SCHEDULED', availableSeats: 2, departureAt: '2026-12-08T00:30:00Z' } as Flight
  const now = Date.parse('2026-12-07T00:00:00Z')
  assert.equal(isBookable(flight, 2, now), true)
  assert.equal(isBookable(flight, 3, now), false)
  assert.equal(isBookable(flight, 1.5, now), false)
  assert.equal(isBookable({ ...flight, status: 'CANCELLED' }, 2, now), false)
  assert.equal(isBookable(flight, 2, Date.parse(flight.departureAt)), false)
});

test('search query preserves the backend field names', () => {
  const params = toSearchParams({
    origin: 'PEK',
    destination: 'HKG',
    departureDate: '2026-12-08',
    passengers: 2,
    departurePeriod: 'MORNING',
    sortBy: 'price',
    sortOrder: 'asc',
  })
  assert.equal(params.get('departurePeriod'), 'MORNING')
  assert.equal(params.get('sortBy'), 'price')
})

test('shared query encoding preserves values and omits unused filters', () => {
  const params = toQueryParams({ q: 'Hong Kong & Macau', limit: 20, page: 0, airlineCode: '', departurePeriod: undefined })
  assert.equal(params.toString(), 'q=Hong+Kong+%26+Macau&limit=20&page=0')
  assert.equal(new URLSearchParams(params.toString()).get('q'), 'Hong Kong & Macau')
})

test('one booking attempt reuses its key until flight or seat count changes', () => {
  let next = 0
  const create = () => `key-${++next}`
  const first = bookingAttempt(null, 'flight-a', 2, create)
  assert.equal(bookingAttempt(first, 'flight-a', 2, create), first)
  assert.notEqual(bookingAttempt(first, 'flight-a', 3, create).idempotencyKey, first.idempotencyKey)
  assert.equal(shiftDate('2026-12-08', 2), '2026-12-10')
})
