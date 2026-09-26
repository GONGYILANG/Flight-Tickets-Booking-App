export interface DemoSeat {
  id: string
  available: boolean
}

export function demoSeatRows(totalSeats: number, availableSeats: number): DemoSeat[][] {
  if (!Number.isSafeInteger(totalSeats) || !Number.isSafeInteger(availableSeats)) return []
  // show at most 20 illustrative rows; real seat assignments need a seat-map API.
  const count = Math.min(120, totalSeats)
  const available = Math.min(count, availableSeats)
  const rows: DemoSeat[][] = []
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / 6)
    ;(rows[row] ??= []).push({
      id: `${row + 1}${'ABCDEF'[index % 6]}`,
      available:
        Math.floor(((index + 1) * available) / count) > Math.floor((index * available) / count),
    })
  }
  return rows
}

export function toggleDemoSeat(selected: string[], seat: DemoSeat, limit: number): string[] {
  if (!seat.available) return selected
  if (selected.includes(seat.id)) return selected.filter((id) => id !== seat.id)
  if (!Number.isInteger(limit) || limit < 1 || limit > 9 || selected.length >= limit)
    return selected
  return [...selected, seat.id]
}
