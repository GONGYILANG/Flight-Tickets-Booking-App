import assert from 'node:assert/strict'
import test from 'node:test'
import { demoSeatRows, toggleDemoSeat } from '../checkout.ts'

test('demo cabin has unique row/letter labels and a bounded illustrative layout', () => {
  const seats = demoSeatRows(180, 42).flat()
  assert.equal(seats.length, 120)
  assert.equal(new Set(seats.map((seat) => seat.id)).size, 120)
  assert.equal(seats.filter((seat) => seat.available).length, 42)
  assert.equal(seats[0]?.id, '1A')
  assert.equal(seats.at(-1)?.id, '20F')
  assert.equal(demoSeatRows(8, 3).flat().length, 8)
  assert.equal(
    demoSeatRows(8, 3)
      .flat()
      .filter((seat) => seat.available).length,
    3,
  )
  assert.deepEqual(demoSeatRows(0, 0), [])
  assert.deepEqual(demoSeatRows(NaN, 3), [])
  assert.equal(
    demoSeatRows(6, 20)
      .flat()
      .filter((seat) => seat.available).length,
    6,
  )
})

test('selection rejects unavailable/extra seats and allows deselection before replacing a seat', () => {
  const a = { id: '1A', available: true }
  const b = { id: '1B', available: true }
  const c = { id: '1C', available: true }
  let selected = toggleDemoSeat([], a, 2)
  selected = toggleDemoSeat(selected, b, 2)
  assert.deepEqual(selected, ['1A', '1B'])
  assert.equal(toggleDemoSeat(selected, c, 2), selected)
  assert.equal(toggleDemoSeat(selected, { id: '2A', available: false }, 3), selected)
  selected = toggleDemoSeat(selected, a, 2)
  assert.deepEqual(toggleDemoSeat(selected, c, 2), ['1B', '1C'])
  assert.deepEqual(toggleDemoSeat([], a, 10), [])
  assert.deepEqual(toggleDemoSeat([], a, 0), [])
})
