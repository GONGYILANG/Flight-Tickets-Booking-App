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
| Turns | `POST` | `/api/sessions/:sessionId/turns` | Yes |
| Turns | `POST` | `/api/sessions/:sessionId/turns/:turnId/finish` | Yes |
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

### Session and Turn

Session summaries contain `sessionId`, `title`, `createdAt`, `updatedAt`, and `lastAccess`. Detail responses additionally contain **all** `turns` ordered by `sequence ASC`. The `sessions` collection stores the owner, metadata, an internal `nextSequence` allocator, and a retryable deletion marker. Messages live in the separate `turns` collection.

Each Turn references its parent Session's MongoDB `_id`. Unique compound indexes on `(session, turnId)` and `(session, sequence)` protect retry identity and ordering. `sequence` starts at 1 and is allocated atomically by the backend. Gaps after concurrent retries or unsuccessful inserts are valid; it represents allocation order, not completion time or the number of turns.

Run `npm run indexes` from `backend` before enabling these routes in production, where automatic index creation is disabled. The index script includes the new Turn collection.

Example completed Turn DTO:

~~~json
{
  "turnId": "16deaf91-c2aa-48a9-b6cd-14d09ba50af9",
  "sequence": 1,
  "status": "completed",
  "messages": [
    { "role": "user", "content": "Find flights." },
    {
      "role": "assistant",
      "content": null,
      "reasoning_content": "Search for available flights.",
      "tool_calls": [{
        "id": "call-1",
        "type": "function",
        "function": { "name": "search_flights", "arguments": "{}" }
      }]
    },
    {
      "role": "tool",
      "tool_call_id": "call-1",
      "content": "{\"ok\":true,\"status\":200,\"data\":{\"flights\":[]}}"
    },
    { "role": "assistant", "content": "No flights found." }
  ],
  "view": {
    "userMessage": "Find flights.",
    "assistantMessage": "No flights found.",
    "events": [
      { "tool": "search_flights", "result": { "ok": true, "status": 200, "data": { "flights": [] } } }
    ]
  },
  "error": null,
  "createdAt": "2026-09-17T09:55:00.000Z",
  "updatedAt": "2026-09-17T09:55:10.000Z"
}
~~~

`messages` preserves the initial user message, every serialized `response.choices[0].message`, and every tool message, including provider fields such as `reasoning_content`. Serialize Python SDK messages with `model_dump(mode="json")`. Never store bearer tokens in model messages. System instructions belong to the middle layer's model context, outside the per-turn transcript.

`view` is generated and stored by the backend from `messages`; callers do not submit a second copy. It contains user text, final assistant text (or `null`), and ordered `{tool, result}` attachments for `ChatEventCards`. Tool IDs and arguments remain in `messages`, outside `view.events`. The middle layer should return views/statuses to the UI and keep raw reasoning/tool transcripts server-side.

Airport cards omit duplicate IATA codes within a turn and discard legacy three-letter substring mismatches using the original tool query. Session reads and completed-turn replays regenerate event cards from the unchanged transcript, so older conversations receive the corrected presentation without a database migration. Tool errors and other tool-event types remain visible.

Sessions and turns have no TTL. Internal MongoDB IDs, owner IDs, sequence counters, and deletion markers are omitted from DTOs.

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
| `match` | No | `fuzzy` | `fuzzy` enables substring autocomplete; `exact` requires a complete IATA code, city name, or airport name. |

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

The AI airport-resolution tool uses `match=exact`, while the frontend airport picker keeps fuzzy autocomplete. For example, an unlisted `SHA` code returns no exact match instead of matching `Shanghai`, `Shaheed`, or `Marshall` by substring. Results describe this application's airport catalogue, not the existence or availability of flights.

Fuzzy autocomplete tolerates spaces inserted within a city name: `shang hai` can match `Shanghai`, and `bei jing` can match `Beijing`. Exact mode retains literal full-name/code matching. The frontend debounces the latest typed query and cancels superseded searches; opening the dropdown never replaces typed text with a recent-search city.

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

Creation and individual cancellation use MongoDB Atlas cross-collection transactions. Keep the unique `{ user: 1, idempotencyKey: 1 }` booking index deployed. The driver retries transient write conflicts and uncertain commit acknowledgements within a 10-second transaction timeout.

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

On a timeout or `500 BOOKING_CREATION_FAILED`, the commit outcome may be unknown. Retry the original payload with the same idempotency key; do not generate a new key for that retry.

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

User and administrator cancellation share the same transaction for the booking status and inventory. On `500 BOOKING_CANCELLATION_FAILED` or a timeout, retry cancellation for the same booking. A failed acknowledgement does not prove that the transaction was rolled back.

Common errors include `400 INVALID_REQUEST`, `404 BOOKING_NOT_FOUND`, `409 BOOKING_NOT_CANCELLABLE`, `503 BOOKING_WRITES_PAUSED`, and `500 BOOKING_CONSISTENCY_ERROR`.

## Session and Turn API

All endpoints require the current user's bearer token and scope access to that user's Session. Owner IDs cannot be supplied in the body. The middle layer now uses these endpoints for chat persistence and exposes FastAPI restoration routes. Bearer authentication establishes ownership, not proof that a transcript was generated by the middle layer; keep transcript writes on a trusted service path when wiring production restoration.

Session requests allow up to **2 MiB** of JSON; ordinary endpoints retain the 100 KiB limit. Unknown request body fields are rejected.

### `POST /api/sessions`

Creates an empty permanent session:

~~~json
{ "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279" }
~~~

The canonical UUID is globally unique. Returns `201` with `{data: {session: <summary>}, meta: {alreadyExists: false}}`. The initial title is `New conversation`; starting sequence 1 sets it to the first 80 characters of the input. The summary includes timestamps but no `turns` array.

Repeating creation as the owner returns `200` and `meta.alreadyExists=true` without clearing history. An ID owned by someone else or currently being deleted returns `409 SESSION_ID_CONFLICT`.

### `GET /api/sessions`

Returns **all** current-user session summaries, ordered by `lastAccess DESC, _id DESC`:

~~~json
{
  "data": {
    "sessions": [{
      "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279",
      "title": "Find flights.",
      "createdAt": "2026-09-17T09:55:00.000Z",
      "updatedAt": "2026-09-17T09:55:10.000Z",
      "lastAccess": "2026-09-17T09:55:10.000Z"
    }]
  }
}
~~~

There is no pagination or message payload. The middle layer can load the sidebar in one request and fetch each session's turns through the detail endpoint.

### `GET /api/sessions/:sessionId`

Returns `{data: {session: <summary plus turns>}}`, including **all** completed, pending, and failed Turns in `sequence ASC` order. Empty sessions have `turns: []`. Reading updates `lastAccess`. No client-side turn grouping or event reconstruction is needed.

Invalid UUIDs return `400 INVALID_REQUEST`; missing, deleting, or other-user sessions return `404 SESSION_NOT_FOUND`.

### `POST /api/sessions/:sessionId/turns`

Persist user input **before** invoking the model or any tools:

~~~json
{
  "turnId": "16deaf91-c2aa-48a9-b6cd-14d09ba50af9",
  "message": "Find flights."
}
~~~

`turnId` is a canonical UUID; reuse the middle layer's `requestId`. `message` is a nonblank string of 1–4000 characters after trimming. The backend assigns `sequence` and saves:

- `status: "pending"`
- `messages: [{role: "user", content: <trimmed message>}]`
- `view: {userMessage: <trimmed message>, assistantMessage: null, events: []}`
- `error: null`

Returns `201` with `{data: {turn: <Turn DTO>}, meta: {alreadyExists: false}}`. Repeating the same ID and input returns the existing Turn with `200` and `alreadyExists=true`, including its current status and any saved result. It does not reset the Turn. Reusing an ID for different input returns `409 TURN_ID_CONFLICT`. Concurrent repeated creates produce one Turn.

A replayed start is not an execution lock. The middle layer must serialize processing per session and avoid launching another model/tool run merely because a pending record exists.

### `POST /api/sessions/:sessionId/turns/:turnId/finish`

Save the **entire turn transcript** in one atomic Turn update after processing:

~~~json
{
  "status": "completed",
  "messages": [
    { "role": "user", "content": "Hello." },
    { "role": "assistant", "content": "How can I help with your flight?" }
  ]
}
~~~

Use the actual initial input and include every intervening assistant/tool message when tools were called. `messages` must contain 1–100 objects and start with the unchanged user input. Subsequent roles are `assistant` and `tool`. Assistant content is a string or `null`; function calls carry unique IDs, names, and argument strings. Arguments are preserved verbatim, including invalid argument JSON when a tool returned a validation error.

Each tool message must reference an unanswered call and contain a JSON-encoded result object. Results for multiple calls may arrive in any order, but all pending calls must be answered before the next assistant message. Completed transcripts must end with nonblank assistant text and no unanswered calls. The backend derives `view.events` in tool-result order.

To record a known failure, submit the available transcript and a short error:

~~~json
{
  "status": "failed",
  "messages": [{ "role": "user", "content": "Find flights." }],
  "error": "The model provider could not complete this turn."
}
~~~

Failed transcripts may end with unanswered tool calls. `error` is required for failures (1–2000 characters), and absent or `null` for completion. A hard crash before this request leaves the initial `pending` record, identifying an unfinished turn. Pending does not prove a worker is still running.

Returns `200` with `{data: {turn: <Turn DTO>}, meta: {alreadyCompleted: false}}`. Completed Turns are immutable: the identical result returns `200` and `alreadyCompleted=true`; a different result or stale failure returns `409 TURN_ALREADY_COMPLETED`. Pending and failed Turns can receive a final result, allowing completion with the same ID after a deliberate retry. Failed snapshots can be replaced; the middle layer remains responsible for serialized retries.

Missing Turns return `404 TURN_NOT_FOUND`. Changed original input returns `409 TURN_ID_CONFLICT`. Invalid transcripts return `400 INVALID_REQUEST`. Saving or replaying a Turn updates the parent Session's `lastAccess`.

This strategy records the start and final result, not each intermediate side effect. A provider/process failure after booking creation does not undo that booking; preserve its existing booking idempotency key when retrying.

### `DELETE /api/sessions/:sessionId`

Permanently deletes the owner's session and associated Turns. Returns `204`, also for missing or other-user sessions. A durable internal deletion marker hides partially deleted sessions and allows DELETE to be retried if collection cleanup fails. No cross-collection transaction support is required.

### Compatibility and middle-layer integration

The middle-layer sequence is:

1. Create/reuse the Session through `POST /api/sessions`.
2. Start the Turn with `turnId=requestId`, and wait for persistence before executing tools.
3. Keep the complete turn transcript in memory during the model/tool loop.
4. Save success or known failure through `POST /api/sessions/:sessionId/turns/:turnId/finish`.
5. Restore the sidebar from `GET /api/sessions` and each conversation from `GET /api/sessions/:sessionId`; return ordered views/statuses to the browser.
6. Reconstruct model context from completed transcripts and system instructions. Handle pending/failed turns explicitly rather than blindly sending unfinished tool chains to the model.

FastAPI implements `GET /api/chat/sessions` and `GET /api/chat/sessions/{sessionId}` (browser proxy paths `/chat-api/chat/sessions` and `/chat-api/chat/sessions/{sessionId}`). They return summaries and ordered views/statuses without raw model messages. Chat processing and deletion use these REST persistence APIs. The frontend loads its sidebar and conversation history through these routes, renders `Turn.view` directly, and refreshes saved state after sending. See [the middle-layer README](../middle/README.md) for pending/failed retry behavior and the single-worker execution requirement.

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
| 404 | `TURN_NOT_FOUND` | The turn does not exist in the owned session. |
| 404 | `ROUTE_NOT_FOUND` | The route does not exist. |
| 409 | `EMAIL_ALREADY_REGISTERED` | The email is already registered. |
| 409 | `FLIGHT_NOT_FOUND_OR_SOLD_OUT` | The flight cannot be booked or lacks seats. |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | A booking key was reused with different payload fields. |
| 409 | `BOOKING_NOT_CANCELLABLE` | The booking cannot currently be cancelled. |
| 409 | `SESSION_ID_CONFLICT` | The globally unique session ID is owned by someone else or is being deleted. |
| 409 | `TURN_ID_CONFLICT` | A turn ID was reused with different user input. |
| 409 | `TURN_ALREADY_COMPLETED` | A completed turn cannot be overwritten with a different result. |
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
2. Let the middle layer create/reuse a Session and persist a pending Turn before AI model/tool execution.
3. Resolve airports with `GET /api/airports/search`.
4. Search with `GET /api/flights/search` and display UTC times in the desired local time zone.
5. Generate one UUID for a booking attempt and reuse it for every retry of that attempt.
6. Use `GET /api/bookings/me` and `GET /api/bookings/:bookingId` for trips and details; cancel through `PATCH /api/bookings/:bookingId/cancel`.
7. Let the middle layer save the full Turn transcript through `POST /api/sessions/:sessionId/turns/:turnId/finish`.
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
| Persistent AI conversations | Session and Turn endpoints through FastAPI | Sidebar and ordered Turn.view history/card restoration are connected; sends persist through the middle layer. |

Password recovery is not exposed because it requires verified email delivery and one-time reset credentials. A language label does not require a backend endpoint.

Bearer authentication remains the client contract. Remember me changes browser storage only and does not extend the server token's 24-hour lifetime.
