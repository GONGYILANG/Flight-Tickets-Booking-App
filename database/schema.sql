-- Flight Booking FYP - PostgreSQL 16 initial schema
-- This is a simulated booking system. It intentionally excludes real flight APIs,
-- fare offers, cabin classes, passenger details, identity documents, and payments.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Users and JWT authentication
-- -----------------------------------------------------------------------------

CREATE TABLE users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email               varchar(320) NOT NULL,
    password_hash       text NOT NULL,
    display_name        varchar(120) NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_status_check
        CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED'))
);

CREATE UNIQUE INDEX users_email_ci_ux ON users (lower(email));

COMMENT ON COLUMN users.password_hash IS
    'Store an Argon2id or bcrypt hash only; never store a plaintext password.';

-- -----------------------------------------------------------------------------
-- Mock flight reference data
-- -----------------------------------------------------------------------------

CREATE TABLE airlines (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                varchar(3) NOT NULL UNIQUE,
    name                varchar(160) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT airlines_code_check CHECK (code ~ '^[A-Z0-9]{2,3}$')
);

CREATE TABLE airports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    iata_code           varchar(3) NOT NULL UNIQUE,
    name                varchar(180) NOT NULL,
    city_name           varchar(120) NOT NULL,
    country_code        varchar(2) NOT NULL,
    timezone            varchar(64) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT airports_iata_check CHECK (iata_code ~ '^[A-Z]{3}$'),
    CONSTRAINT airports_country_check CHECK (country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX airports_city_name_idx ON airports (lower(city_name));

CREATE TABLE flights (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    airline_id              uuid NOT NULL REFERENCES airlines(id),
    flight_number           varchar(12) NOT NULL,
    origin_airport_id       uuid NOT NULL REFERENCES airports(id),
    destination_airport_id  uuid NOT NULL REFERENCES airports(id),
    departure_at            timestamptz NOT NULL,
    arrival_at              timestamptz NOT NULL,
    total_seats             smallint NOT NULL,
    available_seats         smallint NOT NULL,
    status                  varchar(20) NOT NULL DEFAULT 'SCHEDULED',
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT flights_route_check
        CHECK (origin_airport_id <> destination_airport_id),
    CONSTRAINT flights_time_check CHECK (arrival_at > departure_at),
    CONSTRAINT flights_seats_check
        CHECK (total_seats > 0 AND available_seats BETWEEN 0 AND total_seats),
    CONSTRAINT flights_status_check
        CHECK (status IN ('SCHEDULED', 'DELAYED', 'CANCELLED', 'DEPARTED', 'ARRIVED')),
    UNIQUE (airline_id, flight_number, departure_at)
);

CREATE INDEX flights_search_idx
    ON flights (origin_airport_id, destination_airport_id, departure_at);
CREATE INDEX flights_airline_idx ON flights (airline_id, departure_at);

-- -----------------------------------------------------------------------------
-- AI conversation history
-- The model may request tools, but only the backend is allowed to query or update
-- the database.
-- -----------------------------------------------------------------------------

CREATE TABLE chat_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE',
    locale              varchar(16) NOT NULL DEFAULT 'en-HK',
    timezone            varchar(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chat_sessions_status_check
        CHECK (status IN ('ACTIVE', 'COMPLETED', 'ABANDONED'))
);

CREATE INDEX chat_sessions_user_idx ON chat_sessions (user_id, created_at DESC);

CREATE TABLE chat_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_index       integer NOT NULL,
    role                varchar(20) NOT NULL,
    content             text NOT NULL DEFAULT '',
    tool_name           varchar(80),
    tool_arguments      jsonb,
    tool_result         jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chat_messages_index_check CHECK (message_index >= 0),
    CONSTRAINT chat_messages_role_check
        CHECK (role IN ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL')),
    UNIQUE (session_id, message_index)
);

CREATE INDEX chat_messages_session_idx ON chat_messages (session_id, message_index);

COMMENT ON COLUMN chat_messages.tool_arguments IS
    'Validated arguments for an allow-listed backend function; never executable SQL.';

-- -----------------------------------------------------------------------------
-- Simulated bookings
-- No passenger or payment data is stored. A booking only associates a user with
-- a flight and reserves a quantity of seats.
-- -----------------------------------------------------------------------------

CREATE TABLE bookings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_reference   varchar(16) NOT NULL UNIQUE,
    user_id             uuid NOT NULL REFERENCES users(id),
    flight_id           uuid NOT NULL REFERENCES flights(id),
    chat_session_id     uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
    source              varchar(12) NOT NULL DEFAULT 'UI',
    seat_count          smallint NOT NULL DEFAULT 1,
    status              varchar(20) NOT NULL DEFAULT 'CONFIRMED',
    idempotency_key     varchar(100) NOT NULL UNIQUE,
    booked_at           timestamptz NOT NULL DEFAULT now(),
    cancelled_at        timestamptz,
    CONSTRAINT bookings_source_check CHECK (source IN ('UI', 'AI')),
    CONSTRAINT bookings_seat_count_check CHECK (seat_count BETWEEN 1 AND 9),
    CONSTRAINT bookings_status_check CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    CONSTRAINT bookings_cancelled_at_check
        CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL)
            OR (status = 'CONFIRMED' AND cancelled_at IS NULL))
);

CREATE INDEX bookings_user_idx ON bookings (user_id, booked_at DESC);
CREATE INDEX bookings_flight_idx ON bookings (flight_id, status);

-- -----------------------------------------------------------------------------
-- Automatically maintain updated_at on mutable records.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER flights_set_updated_at
BEFORE UPDATE ON flights
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER chat_sessions_set_updated_at
BEFORE UPDATE ON chat_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
