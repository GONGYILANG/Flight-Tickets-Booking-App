# Flight Booking Backend API Reference

This document describes the HTTP API implemented in `backend/src`.

The default local base URL is:

```text
http://localhost:3000
```

Send the following header with JSON request bodies:

```http
Content-Type: application/json
```

## API overview

| Area | Method | Path | Authentication |
| --- | --- | --- | --- |
| Health | `GET` | `/api/health` | No |
| Authentication | `POST` | `/api/auth/register` | No |
| Authentication | `POST` | `/api/auth/login` | No |
| Authentication | `POST` | `/api/auth/logout` | Yes |
| Authentication | `GET` | `/api/auth/me` | Yes |
| Airports | `GET` | `/api/airports/search` | No |
| Airlines | `GET` | `/api/airlines` | No |
| Flights | `GET` | `/api/flights/search` | No |
| Flights | `GET` | `/api/flights/:flightId` | No |
| Bookings | `POST` | `/api/bookings` | Yes |
| Bookings | `GET` | `/api/bookings/me` | Yes |
| Bookings | `GET` | `/api/bookings/:bookingId` | Yes |
| Bookings | `PATCH` | `/api/bookings/:bookingId/cancel` | Yes |
| Sessions | `POST` | `/api/sessions` | Yes |
| Sessions | `GET` | `/api/sessions` | Yes |
| Sessions | `GET` | `/api/sessions/:sessionId` | Yes |
| Sessions | `POST` | `/api/sessions/:sessionId/messages` | Yes |
| Sessions | `DELETE` | `/api/sessions/:sessionId` | Yes |
| Administration | `GET` | `/api/admin/users` | Admin |
| Administration | `GET` | `/api/admin/users/:userId` | Admin |
| Administration | `PATCH` | `/api/admin/users/:userId/status` | Admin |
| Administration | `GET` | `/api/admin/bookings` | Admin |
| Administration | `GET` | `/api/admin/bookings/:bookingId` | Admin |
| Administration | `PATCH` | `/api/admin/bookings/:bookingId/cancel` | Admin |
| Administration | `GET` | `/api/admin/flights` | Admin |
| Administration | `GET` | `/api/admin/flights/:flightId` | Admin |
| Administration | `PATCH` | `/api/admin/flights/:flightId/schedule` | Admin |
| Administration | `PATCH` | `/api/admin/flights/:flightId` | Admin |

## Common conventions

### Authentication

Protected endpoints require a JWT Bearer token:

```http
Authorization: Bearer <accessToken>
```

The register and login endpoints issue `accessToken`. Its default lifetime is 24 hours (`JWT_EXPIRES_IN=24h`); selecting Remember me does not extend it. Missing, expired, revoked, or invalid tokens return `401`. Locked or disabled users return `403`.

The server stores each issued raw JWT in `users.tokens` without the `Bearer ` prefix. Every token has an independent random `jti`, so one user can remain signed in on multiple devices. A protected request must pass signature and expiry validation, the token must still be present in `users.tokens`, and the user must have `status=ACTIVE`.

`tokens` is excluded from normal User and administrator responses. The former `tokenVersion` field is not used; users holding older tokens that were never stored in `tokens` must sign in again.

### Time and time zones

- Response timestamps use ISO 8601 UTC strings, for example `2026-12-08T00:30:00.000Z`.
- Flight `departureDate` is interpreted in the departure airport's local time zone.
- Searches exclude flights whose departure time is not later than the current server time.
- `MORNING` means local `00:00` inclusive through `12:00` exclusive.
- `AFTERNOON` means local `12:00` inclusive through the next `00:00` exclusive.

### Money

- The currency is USD.
- Public amounts are fixed two-decimal strings such as `"325.00"` to avoid client floating-point errors.
- `Flight.price` is the current price per seat.
- `Booking.pricing` is the immutable price snapshot captured when the booking was created.

### Pagination

Paginated endpoints return:

```json
{
  "page": 1,
  "limit": 20,
  "totalItems": 42,
  "totalPages": 3
}
```

Page numbers start at `1`.

### Error format

Error responses use:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "One or more request parameters are invalid",
    "details": {
      "fields": [
        {
          "field": "origin",
          "message": "origin must be a three-letter IATA airport code"
        }
      ]
    }
  }
}
```

`details.fields` is present only when body, path, or query validation fails.

## Data objects

### User

```json
{
  "id": "66a1b2c3d4e5f67890123456",
  "email": "student@example.com",
  "displayName": "Student",
  "status": "ACTIVE",
  "role": "USER"
}
```

`status` is `ACTIVE`, `LOCKED`, or `DISABLED`. `role` is `USER` or `ADMIN`; registration always creates a `USER`.

### Airport

```json
{
  "id": "66a1b2c3d4e5f67890123456",
  "iataCode": "PEK",
  "name": "Beijing Capital International Airport",
  "cityName": "Beijing",
  "countryCode": "CN",
  "timezone": "Asia/Shanghai"
}
```

### Flight

```json
{
  "id": "66a1b2c3d4e5f67890123456",
  "flightNumber": "CX101",
  "airline": {
    "id": "66a1b2c3d4e5f67890120001",
    "code": "CX",
    "name": "Cathay Pacific"
  },
  "originAirport": {
    "id": "66a1b2c3d4e5f67890120002",
    "iataCode": "PEK",
    "name": "Beijing Capital International Airport",
    "cityName": "Beijing",
    "countryCode": "CN",
    "timezone": "Asia/Shanghai"
  },
  "destinationAirport": {
    "id": "66a1b2c3d4e5f67890120003",
    "iataCode": "HKG",
    "name": "Hong Kong International Airport",
    "cityName": "Hong Kong",
    "countryCode": "HK",
    "timezone": "Asia/Hong_Kong"
  },
  "departureAt": "2026-12-08T00:30:00.000Z",
  "arrivalAt": "2026-12-08T04:00:00.000Z",
  "scheduledDepartureAt": "2026-12-08T00:30:00.000Z",
  "scheduledArrivalAt": "2026-12-08T04:00:00.000Z",
  "scheduleChanged": false,
  "durationMinutes": 210,
  "price": {
    "amount": "380.00",
    "currency": "USD"
  },
  "totalSeats": 180,
  "availableSeats": 42,
  "status": "SCHEDULED"
}
```

Flight status is `SCHEDULED`, `DELAYED`, `CANCELLED`, `DEPARTED`, or `ARRIVED`. Only future `SCHEDULED` and `DELAYED` flights can be booked.

`scheduledDepartureAt` and `scheduledArrivalAt` retain the original schedule. `departureAt` and `arrivalAt` contain the current effective schedule. `scheduleChanged` is true when the current schedule differs from the original one.

### Booking

```json
{
  "id": "66a1b2c3d4e5f67890123499",
  "bookingReference": "BK1A2B3C4D5E6",
  "flight": { "...": "full public Flight object" },
  "seatCount": 2,
  "pricing": {
    "unitAmount": "380.00",
    "totalAmount": "760.00",
    "currency": "USD"
  },
  "source": "UI",
  "status": "CONFIRMED",
  "cancellation": null,
  "createdAt": "2026-08-24T10:00:00.000Z",
  "updatedAt": "2026-08-24T10:00:00.000Z",
  "cancelledAt": null
}
```

`source` is `UI` or `AI`; `status` is `CONFIRMED` or `CANCELLED`. Public Booking objects omit the user ID, password data, `idempotencyKey`, internal cent values, and Mongoose fields.

### Session

```json
{
  "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279",
  "createdAt": "2026-09-15T09:55:00.000Z",
  "updatedAt": "2026-09-15T10:00:00.000Z",
  "lastAccess": "2026-09-15T10:00:00.000Z",
  "history": [
    { "role": "user", "content": "Find a flight from PEK to HKG tomorrow." },
    { "role": "assistant", "content": "I found one matching flight." }
  ]
}
```

`history` is one flat, ordered array of JSON-compatible model messages with roles `system`, `user`, `assistant`, or `tool`. It can include assistant tool calls and their tool responses. Do not place authentication tokens in model messages. Sessions are retained until explicitly deleted; `lastAccess` has no TTL index. Responses never expose the owning user ID.

## Health API

### `GET /api/health`

Checks the HTTP service and MongoDB connection. Authentication is not required.

Successful response (`200`):

```json
{
  "status": "ok",
  "timestamp": "2026-08-24T10:00:00.000Z",
  "uptimeSeconds": 3600,
  "database": {
    "status": "connected",
    "name": "flightBookingDB"
  }
}
```

An unavailable database returns `503` with `status="unavailable"`.

## Authentication API

### `POST /api/auth/register`

Creates a user and immediately returns an access token. Authentication is not required.

Request body:

```json
{
  "email": "student@example.com",
  "password": "correct-horse-battery-staple",
  "displayName": "Student"
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `email` | Yes | Valid email, trimmed and lowercased, maximum 320 characters. |
| `password` | Yes | UTF-8 byte length from 8 to 72. |
| `displayName` | Yes | Trimmed length from 2 to 120. |

Successful response (`201`):

```json
{
  "data": {
    "user": {
      "id": "66a1b2c3d4e5f67890123456",
      "email": "student@example.com",
      "displayName": "Student",
      "status": "ACTIVE",
      "role": "USER"
    },
    "accessToken": "<JWT>",
    "tokenType": "Bearer",
    "expiresIn": "24h"
  }
}
```

Common errors are `400 INVALID_REQUEST` and `409 EMAIL_ALREADY_REGISTERED`.

### `POST /api/auth/login`

Signs in with email and password. Authentication is not required.

```json
{
  "email": "student@example.com",
  "password": "correct-horse-battery-staple"
}
```

The successful `200` response has the same `data` shape as registration. Common errors are `400 INVALID_REQUEST`, `401 INVALID_CREDENTIALS`, and `403 ACCOUNT_NOT_ACTIVE`.

### `POST /api/auth/logout`

Requires authentication and no request body. A successful logout returns `204 No Content`.

The server atomically removes only the current raw token from `users.tokens`; tokens issued to other devices remain valid. Reusing the removed token returns `401 TOKEN_REVOKED`.

### `GET /api/auth/me`

Returns the authenticated user.

```json
{
  "data": {
    "user": {
      "id": "66a1b2c3d4e5f67890123456",
      "email": "student@example.com",
      "displayName": "Student",
      "status": "ACTIVE",
      "role": "USER"
    }
  }
}
```

## Airport API

### `GET /api/airports/search`

Searches by IATA code, airport name, or city name.

| Parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `q` | Yes | — | 1–80 characters, case-insensitive. |
| `limit` | No | `10` | Integer from 1 to 20. |

```http
GET /api/airports/search?q=beijing&limit=10
```

Successful response (`200`):

```json
{
  "data": {
    "airports": [
      {
        "id": "66a1b2c3d4e5f67890120002",
        "iataCode": "PEK",
        "name": "Beijing Capital International Airport",
        "cityName": "Beijing",
        "countryCode": "CN",
        "timezone": "Asia/Shanghai"
      }
    ]
  }
}
```

Results rank exact IATA matches first, followed by IATA prefixes, exact city matches, city prefixes, and airport name prefixes. Invalid parameters return `400 INVALID_REQUEST`.

## Airline API

### `GET /api/airlines`

Returns all airlines with `active=true`, ordered by name and code. Authentication and query parameters are not required.

```json
{
  "data": {
    "airlines": [
      { "code": "CA", "name": "Air China" },
      { "code": "CX", "name": "Cathay Pacific" }
    ]
  }
}
```

The list is a directory of enabled airlines and does not guarantee that an airline operates on a particular route or date.

## Flight API

### `GET /api/flights/search`

Searches bookable direct flights by exact departure airport, destination airport, and local departure date. Results contain only future `SCHEDULED` or `DELAYED` flights with at least the requested number of seats.

| Parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `origin` | Yes | — | Three-letter IATA code, uppercased. |
| `destination` | Yes | — | Three-letter IATA code, different from `origin`. |
| `departureDate` | Yes | — | Valid `YYYY-MM-DD` date in the origin airport's time zone. |
| `departurePeriod` | No | `null` | `MORNING` or `AFTERNOON`. |
| `airlineCode` | No | `null` | Enabled two- or three-character airline code. |
| `passengers` | No | `1` | Integer from 1 to 9. |
| `page` | No | `1` | Integer from 1 to 10000. |
| `limit` | No | `20` | Integer from 1 to 50. |
| `sortBy` | No | `departureAt` | `departureAt`, `arrivalAt`, `availableSeats`, or `price`. |
| `sortOrder` | No | `asc` | `asc` or `desc`. |

```http
GET /api/flights/search?origin=PEK&destination=HKG&departureDate=2026-12-08&departurePeriod=MORNING&airlineCode=CX&passengers=2&sortBy=price&sortOrder=asc&page=1&limit=20
```

Successful response (`200`):

```json
{
  "data": {
    "flights": [
      { "...": "full public Flight object" }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    },
    "search": {
      "origin": "PEK",
      "destination": "HKG",
      "departureDate": "2026-12-08",
      "departurePeriod": "MORNING",
      "departureTimezone": "Asia/Shanghai",
      "airlineCode": "CX",
      "passengers": 2,
      "sortBy": "price",
      "sortOrder": "asc"
    }
  }
}
```

Invalid input, unknown airports, or an unknown airline return `400 INVALID_REQUEST`. A valid search with no matching flights returns `200` with an empty array.

### `GET /api/flights/:flightId`

Returns one public Flight object by MongoDB ObjectId.

```http
GET /api/flights/66a1b2c3d4e5f67890123456
```

```json
{
  "data": {
    "flight": { "...": "full public Flight object" }
  }
}
```

An invalid ID returns `400 INVALID_REQUEST`; an unknown flight returns `404 FLIGHT_NOT_FOUND`.

## Booking API

Booking endpoints operate only on the user identified by the Bearer token. A client cannot select a user in the request body.

### `POST /api/bookings`

Creates a simulated booking and atomically decrements available seats.

```json
{
  "flightId": "66a1b2c3d4e5f67890123456",
  "seatCount": 2,
  "source": "UI",
  "idempotencyKey": "b6d30236-8e1f-4e75-9d5d-0d305f4a1b6e"
}
```

| Field | Required | Default | Rules |
| --- | --- | --- | --- |
| `flightId` | Yes | — | Valid MongoDB ObjectId. |
| `seatCount` | No | `1` | Integer from 1 to 9. |
| `source` | No | `UI` | `UI` or `AI`, trimmed and uppercased. |
| `idempotencyKey` | Yes | — | Canonical UUID, trimmed and lowercased. |

The same user and key with the same `flightId`, `seatCount`, and `source` returns the original booking without decrementing seats again. Reusing the key with different payload fields returns `409 IDEMPOTENCY_KEY_CONFLICT`. Different users may use the same UUID.

Initial creation returns `201`:

```json
{
  "data": {
    "booking": { "...": "full public Booking object" }
  },
  "meta": {
    "idempotentReplay": false
  }
}
```

An idempotent replay returns `200` with the same booking and `meta.idempotentReplay=true`.

A flight must exist, be in the future, have status `SCHEDULED` or `DELAYED`, and have `availableSeats >= seatCount`.

Common errors include `400 INVALID_REQUEST`, authentication errors, `409 FLIGHT_NOT_FOUND_OR_SOLD_OUT`, `409 IDEMPOTENCY_KEY_CONFLICT`, `503 BOOKING_WRITES_PAUSED`, and consistency-related `500` errors.

### `GET /api/bookings/me`

Returns the current user's bookings ordered by `createdAt DESC, _id DESC`.

| Parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `page` | No | `1` | Integer from 1 to 10000. |
| `limit` | No | `20` | Integer from 1 to 50. |

```json
{
  "data": {
    "bookings": [
      { "...": "full public Booking object" }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

### `GET /api/bookings/:bookingId`

Returns one booking owned by the authenticated user. Invalid IDs return `400 INVALID_REQUEST`. Missing bookings and bookings belonging to another user both return `404 BOOKING_NOT_FOUND`.

```json
{
  "data": {
    "booking": { "...": "full public Booking object" }
  }
}
```

### `PATCH /api/bookings/:bookingId/cancel`

Cancels a confirmed booking owned by the current user and restores its seats. The flight must still be a future `SCHEDULED` or `DELAYED` flight. No request body is required.

```json
{
  "data": {
    "booking": {
      "...": "full public Booking object",
      "status": "CANCELLED",
      "cancellation": {
        "source": "USER",
        "reason": null
      }
    }
  },
  "meta": {
    "alreadyCancelled": false
  }
}
```

Repeated or concurrent cancellation returns the same booking with `meta.alreadyCancelled=true` and never restores seats twice.

Common errors include `400 INVALID_REQUEST`, `404 BOOKING_NOT_FOUND`, `409 BOOKING_NOT_CANCELLABLE`, `503 BOOKING_WRITES_PAUSED`, and `500 BOOKING_CONSISTENCY_ERROR`.

## Session API

Session endpoints require authentication and always scope records to `request.user._id`. The owning user ID is never accepted from a request body or exposed in a response.

Sessions do not expire automatically. Existing messages are append-only: the API provides no endpoint for editing or deleting an individual message. The backend does not store HTTP retry replies or request IDs in Session records; the AI middle layer keeps its short-lived reply cache separately.

### `POST /api/sessions`

Creates an empty permanent session.

```json
{
  "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279"
}
```

`sessionId` is required and must be a canonical UUID. It is globally unique.

Initial creation returns `201`:

```json
{
  "data": {
    "session": {
      "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279",
      "createdAt": "2026-09-15T09:55:00.000Z",
      "updatedAt": "2026-09-15T09:55:00.000Z",
      "lastAccess": "2026-09-15T09:55:00.000Z",
      "history": []
    }
  },
  "meta": {
    "alreadyExists": false
  }
}
```

Repeating the request as the same user returns `200` with the existing session and `meta.alreadyExists=true`. If another user already owns that globally unique ID, the response is `409 SESSION_ID_CONFLICT`.

### `GET /api/sessions`

Lists the current user's sessions, ordered by `lastAccess DESC, _id DESC`. List entries omit `history`.

| Parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `page` | No | `1` | Integer from 1 to 10000. |
| `limit` | No | `20` | Integer from 1 to 50. |

```json
{
  "data": {
    "sessions": [
      {
        "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279",
        "createdAt": "2026-09-15T09:55:00.000Z",
        "updatedAt": "2026-09-15T10:00:00.000Z",
        "lastAccess": "2026-09-15T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

### `GET /api/sessions/:sessionId`

Returns the current user's session with its complete `history`. Reading the session updates `lastAccess`. An invalid UUID returns `400 INVALID_REQUEST`; a missing session or another user's session returns `404 SESSION_NOT_FOUND`.

```json
{
  "data": {
    "session": { "...": "full Session object" }
  }
}
```

### `POST /api/sessions/:sessionId/messages`

Atomically appends a batch of ordered messages to `history` without changing earlier messages.

```json
{
  "messages": [
    { "role": "user", "content": "Find a flight from PEK to HKG tomorrow." },
    { "role": "assistant", "content": "I found one matching flight." }
  ]
}
```

`messages` must contain 1–100 JSON objects, each with a `role` of `system`, `user`, `assistant`, or `tool`. Successful append returns `204 No Content`. Messages within a batch remain consecutive even when other clients append concurrently. This endpoint does not deduplicate repeated batches.

### `DELETE /api/sessions/:sessionId`

Permanently deletes the current user's session and all its history. It returns `204 No Content`. Deleting a missing session or another user's session is also a harmless `204` and does not reveal whether that session exists.

There are no `PATCH` or `PUT` Session endpoints. A client that needs to correct a conversation must append new messages or create a new session.

## Administration API

Administrators sign in through `POST /api/auth/login`. Every `/api/admin/*` request requires a current user with:

```text
status = ACTIVE
role = ADMIN
```

Normal users receive `403 ADMIN_REQUIRED`. Authorization uses the user's current database state, so locking an account or removing its role immediately removes access from already issued tokens.

### `GET /api/admin/users`

Lists registered users.

| Parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `q` | No | — | Case-insensitive email or display-name substring, 1–100 characters. |
| `status` | No | — | `ACTIVE`, `LOCKED`, or `DISABLED`. |
| `role` | No | — | `USER` or `ADMIN`. |
| `page` | No | `1` | Integer from 1 to 10000. |
| `limit` | No | `20` | Integer from 1 to 50. |

Results are ordered by `createdAt DESC, _id DESC` and include pagination.

### `GET /api/admin/users/:userId`

Returns one administrator User DTO, its latest status change, and booking counts:

```json
{
  "data": {
    "user": { "...": "administrator User object" },
    "statusChange": null,
    "bookingSummary": {
      "total": 10,
      "confirmed": 7,
      "cancelled": 3
    }
  }
}
```

An unknown user returns `404 USER_NOT_FOUND`.

### `PATCH /api/admin/users/:userId/status`

Locks, disables, or reactivates a user:

```json
{
  "status": "LOCKED",
  "reason": "Suspicious account activity"
}
```

`reason` must contain 3–500 trimmed characters. An active administrator cannot lock or disable themselves or another administrator. Replaying the current state returns `meta.changed=false`. This endpoint cannot change email, display name, password, or role.

### `GET /api/admin/bookings`

Lists all users' bookings. Supported filters are:

```text
userId
flightId
bookingReference
status          CONFIRMED | CANCELLED
source          UI | AI
createdFrom     ISO 8601 timestamp
createdTo       ISO 8601 timestamp
page
limit
```

Results are ordered by `createdAt DESC, _id DESC`. Each administrator Booking object adds a safe user summary to the normal Booking object. It omits `idempotencyKey`, `priceSnapshot`, and password data.

### `GET /api/admin/bookings/:bookingId`

Returns one administrator Booking object. An unknown booking returns `404 BOOKING_NOT_FOUND`.

### `PATCH /api/admin/bookings/:bookingId/cancel`

Cancels a confirmed booking on a future `SCHEDULED` or `DELAYED` flight:

```json
{
  "reason": "Cancelled after customer support request"
}
```

The first cancellation sets `cancellation.source=ADMIN` and restores seats. Repeated or concurrent requests return `meta.alreadyCancelled=true` without restoring seats again. Reconfirmation, editing, deletion, and booking creation on behalf of a user are not supported.

### `GET /api/admin/flights`

Lists all flights, including past and `CANCELLED`, `DEPARTED`, or `ARRIVED` flights.

| Parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `flightNumber` | No | — | Exact 2–12 character alphanumeric value. |
| `airlineCode` | No | — | Existing two- or three-character airline code. |
| `origin` | No | — | Existing three-letter IATA code. |
| `destination` | No | — | Existing IATA code, different from `origin`. |
| `status` | No | — | Any valid flight status. |
| `departureFrom` | No | — | Inclusive ISO 8601 timestamp. |
| `departureTo` | No | — | Inclusive ISO 8601 timestamp not before `departureFrom`. |
| `page` | No | `1` | Integer from 1 to 10000. |
| `limit` | No | `20` | Integer from 1 to 50. |
| `sortBy` | No | `departureAt` | `departureAt`, `arrivalAt`, `availableSeats`, `price`, or `createdAt`. |
| `sortOrder` | No | `asc` | `asc` or `desc`. |

Results use the selected field and `_id` for stable ordering. List entries omit full schedule-change history.

### `GET /api/admin/flights/:flightId`

Returns an administrator Flight object. In addition to public Flight fields it includes `priceCents`, status audit fields, `scheduleVersion`, and complete schedule history:

```json
{
  "data": {
    "flight": {
      "...": "public Flight fields",
      "priceCents": 42000,
      "statusUpdatedAt": "2026-08-24T10:00:00.000Z",
      "statusUpdatedBy": { "id": "...", "email": "admin@example.com" },
      "statusReason": "Operational delay",
      "scheduleVersion": 1,
      "scheduleChanges": [
        {
          "revision": 1,
          "previousDepartureAt": "2026-12-08T00:30:00.000Z",
          "previousArrivalAt": "2026-12-08T04:00:00.000Z",
          "departureAt": "2026-12-08T02:30:00.000Z",
          "arrivalAt": "2026-12-08T06:00:00.000Z",
          "changedAt": "2026-08-24T10:00:00.000Z",
          "changedBy": { "id": "...", "email": "admin@example.com" },
          "reason": "Operational delay"
        }
      ]
    }
  }
}
```

### `PATCH /api/admin/flights/:flightId/schedule`

Atomically changes the effective schedule of a future `SCHEDULED` or `DELAYED` flight and preserves the original schedule and change history.

```json
{
  "departureAt": "2026-12-08T02:30:00.000Z",
  "arrivalAt": "2026-12-08T06:00:00.000Z",
  "expectedScheduleVersion": 0,
  "reason": "Operational delay"
}
```

- Both timestamps are required, must include `Z` or a UTC offset, and must satisfy `arrivalAt > departureAt`.
- The new departure must be in the future.
- `expectedScheduleVersion` must match the latest value read by the administrator. A stale version returns `409 FLIGHT_SCHEDULE_CONFLICT`.
- A change increments the version and appends an immutable `scheduleChanges` entry.
- Delaying a `SCHEDULED` flight automatically changes its status to `DELAYED`.
- Original scheduled timestamps remain unchanged.
- `meta.affectedBookings` reports related bookings that were still confirmed at update time.
- Replaying the current times and version returns `meta.changed=false` without adding history.

### `PATCH /api/admin/flights/:flightId`

Changes price, status, or both:

```json
{
  "status": "DELAYED",
  "priceCents": 42000,
  "reason": "Operational delay"
}
```

- At least one of `status` and `priceCents` is required; only those fields and `reason` are accepted.
- `priceCents` must be a positive safe integer and can be changed only for `SCHEDULED` or `DELAYED` flights.
- Price changes do not alter existing booking snapshots.
- A status change requires a 3–500 character reason.
- Allowed transitions are `SCHEDULED -> DELAYED | CANCELLED | DEPARTED`, `DELAYED -> SCHEDULED | CANCELLED | DEPARTED`, and `DEPARTED -> ARRIVED`.
- `CANCELLED` and `ARRIVED` are terminal states.

The response `meta` contains:

```json
{
  "changed": true,
  "changedFields": ["status", "priceCents"],
  "affectedBookings": 0
}
```

Changing a flight to `CANCELLED` cancels all its confirmed bookings, sets `cancellation.source=FLIGHT`, and restores `availableSeats` to `totalSeats`. Repeated requests continue repairing missed bookings without changing already cancelled ones.

The current API does not create or physically delete flights. Cancellation represents deletion from normal availability.

### Administrator and maintenance commands

Report legacy user, booking, flight, schedule, and index migrations:

```powershell
npm run migrate:admin
```

Apply the migration during a booking-write maintenance window:

```powershell
$env:BOOKING_WRITES_PAUSED="true"
npm run migrate:admin -- --apply
```

Grant or remove an administrator role:

```powershell
npm run admin:role -- --email admin@example.com --role ADMIN --apply
```

Check flight cancellation and booking consistency:

```powershell
npm run reconcile:admin
```

Repairs require a maintenance window and `BOOKING_WRITES_PAUSED=true`.

## Error code reference

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | A body, path, or query field is invalid. |
| 400 | `INVALID_ID` | A service received an invalid ObjectId or UUID. |
| 400 | `ADMIN_REASON_REQUIRED` | An administrator operation lacks a valid reason. |
| 400 | `INVALID_FLIGHT_SCHEDULE` | Arrival is not later than departure. |
| 401 | `AUTH_REQUIRED` | The Bearer token is missing or malformed. |
| 401 | `INVALID_CREDENTIALS` | The login email or password is incorrect. |
| 401 | `INVALID_TOKEN` | The token, signature, or referenced user is invalid. |
| 401 | `TOKEN_EXPIRED` | The token has expired. |
| 401 | `TOKEN_REVOKED` | The server has revoked the token. |
| 403 | `ACCOUNT_NOT_ACTIVE` | The user is not active. |
| 403 | `ADMIN_REQUIRED` | The current user is not an administrator. |
| 404 | `FLIGHT_NOT_FOUND` | The flight does not exist. |
| 404 | `BOOKING_NOT_FOUND` | The booking is missing or belongs to another user. |
| 404 | `SESSION_NOT_FOUND` | The session is missing or belongs to another user. |
| 404 | `ROUTE_NOT_FOUND` | The route does not exist. |
| 409 | `EMAIL_ALREADY_REGISTERED` | The email is already registered. |
| 409 | `FLIGHT_NOT_FOUND_OR_SOLD_OUT` | The flight cannot be booked or lacks seats. |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | A booking key was reused with different payload fields. |
| 409 | `BOOKING_NOT_CANCELLABLE` | The booking cannot currently be cancelled. |
| 409 | `SESSION_ID_CONFLICT` | Another user already owns the globally unique session ID. |
| 409 | `INVALID_STATUS_TRANSITION` | A flight status transition is not allowed. |
| 409 | `FLIGHT_PRICE_NOT_EDITABLE` | The current flight status does not allow price changes. |
| 409 | `FLIGHT_SCHEDULE_NOT_EDITABLE` | The current flight status does not allow schedule changes. |
| 409 | `FLIGHT_SCHEDULE_CONFLICT` | The schedule version is stale or another update won. |
| 409 | `FLIGHT_SCHEDULE_IN_PAST` | The new departure time is not in the future. |
| 409 | `USER_STATUS_CONFLICT` | Another request changed the user status. |
| 409 | `FLIGHT_UPDATE_CONFLICT` | Another request changed the flight. |
| 500 | `BOOKING_CREATION_FAILED` | Booking creation failed after compensation. |
| 500 | `BOOKING_CONSISTENCY_ERROR` | Booking and inventory state cannot be confirmed safely. |
| 500 | `ADMIN_CONSISTENCY_ERROR` | An administrator operation requires reconciliation. |
| 503 | `BOOKING_WRITES_PAUSED` | Booking creation and cancellation are paused. |

## Recommended client flow

1. Call `POST /api/auth/register` or `POST /api/auth/login` to obtain a JWT.
2. Call `POST /api/sessions` with a new UUID when starting an AI conversation.
3. Resolve airports with `GET /api/airports/search`.
4. Search with `GET /api/flights/search` and display UTC times in the desired local time zone.
5. Generate one UUID for a booking attempt and reuse it for every retry of that attempt.
6. Use `GET /api/bookings/me` and `GET /api/bookings/:bookingId` for trips and details; cancel through `PATCH /api/bookings/:bookingId/cancel`.
7. Append completed model messages through `POST /api/sessions/:sessionId/messages`.
8. Use `POST /api/auth/logout` to revoke the current token.

The AI middle layer must use these authenticated APIs rather than accessing MongoDB directly or bypassing booking validation, inventory checks, and idempotency.

## Current frontend mapping

| Frontend requirement | API | Status |
| --- | --- | --- |
| Registration, login, read-only profile | Authentication endpoints | Supported; no profile-editing API is needed. |
| Server-side logout | `POST /api/auth/logout` | Removes only the current token. |
| Airport selection | `GET /api/airports/search` | Resolves a concrete IATA airport. |
| Airline options | `GET /api/airlines` | Returns the complete enabled directory. |
| Flight filters and pagination | `GET /api/flights/search` | Filtering and ordering remain server-side. |
| Five-day lowest-price strip | Five searches with `limit=1&sortBy=price&sortOrder=asc` | Reuses real search results. |
| Flight details and booking | Flight detail and booking endpoints | Retries reuse one UUID. |
| Trips, booking details, cancellation | Booking endpoints | Supported and scoped to the current user. |
| Persistent AI conversations | Session endpoints | Backend storage is available; the middle layer and frontend must use it. |

Password recovery is not exposed because it requires verified email delivery and one-time reset credentials. A language label does not require a backend endpoint.

Bearer authentication remains the client contract. Remember me changes browser storage only and does not extend the server token's 24-hour lifetime.
