export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED'
export type FlightStatus = 'SCHEDULED' | 'DELAYED' | 'CANCELLED' | 'DEPARTED' | 'ARRIVED'
export type BookingStatus = 'CONFIRMED' | 'CANCELLED'
export type BookingSource = 'UI' | 'AI'
export type DeparturePeriod = 'MORNING' | 'AFTERNOON'
export type SortField = 'departureAt' | 'arrivalAt' | 'availableSeats' | 'price'

export interface User {
  id: string
  email: string
  displayName: string
  status: UserStatus
  role: 'USER' | 'ADMIN'
}

export interface Airport {
  id: string
  iataCode: string
  name: string
  cityName: string
  countryCode: string
  timezone: string
}

export interface Flight {
  id: string
  flightNumber: string
  airline: { id: string; code: string; name: string }
  originAirport: Airport
  destinationAirport: Airport
  departureAt: string
  arrivalAt: string
  scheduledDepartureAt: string
  scheduledArrivalAt: string
  scheduleChanged: boolean
  durationMinutes: number
  price: { amount: string; currency: string }
  totalSeats: number
  availableSeats: number
  status: FlightStatus
}

export interface Booking {
  id: string
  bookingReference: string
  flight: Flight
  seatCount: number
  pricing: { unitAmount: string; totalAmount: string; currency: string }
  source: BookingSource
  status: BookingStatus
  cancellation: null | { source: 'USER' | 'ADMIN' | 'FLIGHT'; reason: string | null }
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
}

export interface Pagination {
  page: number
  limit: number
  totalItems: number
  totalPages: number
}

export interface FlightSearchParams {
  origin: string
  destination: string
  departureDate: string
  passengers: number
  departurePeriod?: DeparturePeriod
  airlineCode?: string
  page?: number
  limit?: number
  sortBy?: SortField
  sortOrder?: 'asc' | 'desc'
}

export type ChatToolName =
  | 'search_airports'
  | 'search_flights'
  | 'get_flight'
  | 'create_booking'
  | 'list_my_bookings'
  | 'cancel_booking'

export interface ChatEvent {
  tool: ChatToolName
  result: {
    ok: boolean
    status: number
    // tool payloads reuse the backend DTOs; split into a union if tools evolve independently.
    data?: Record<string, unknown>
    meta?: Record<string, unknown>
    error?: { code: string; message: string }
  }
}

export interface ChatTurn {
  turnId: string
  // Only the server assigns ordering keys; optimistic messages have no sequence yet.
  sequence?: number
  status: 'pending' | 'completed' | 'failed'
  view: { userMessage: string; assistantMessage: string | null; events: ChatEvent[] }
  error: string | null
  delivery?: 'sending' | 'unconfirmed'
}

export interface ChatSessionSummary {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  lastAccess: string
}

export interface ChatSession extends ChatSessionSummary {
  turns: ChatTurn[]
}

export interface ChatConversation {
  id: string
  title: string
  turns: ChatTurn[]
  updatedAt: number
  persisted: boolean
  loaded: boolean
  loadError: string
}
