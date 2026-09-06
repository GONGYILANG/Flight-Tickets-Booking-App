<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { createBooking, getFlight } from '../api'
import {
  amountToCents,
  bookingAttempt,
  boundedInteger,
  centsToAmount,
  formatDuration,
  formatFlightDate,
  formatMoney,
  formatTime,
  isBookable,
  type PendingBooking,
} from '../lib'
import type { Flight } from '../types'

const PENDING_KEY = 'flight-booking-pending-booking'
const route = useRoute()
const router = useRouter()
const flight = ref<Flight | null>(null)
const passengers = ref(boundedInteger(route.query.passengers, 1, 9))
const loading = ref(true)
const booking = ref(false)
const error = ref('')
const bookingError = ref('')
const reload = ref(0)

const totalAmount = computed(() => {
  if (!flight.value) return '0.00'
  return centsToAmount(amountToCents(flight.value.price.amount) * passengers.value)
})

function readPending(): PendingBooking | null {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as PendingBooking | null
  } catch {
    sessionStorage.removeItem(PENDING_KEY)
    return null
  }
}

watch(
  [() => route.params.flightId, reload],
  async (_value, _old, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    loading.value = true
    error.value = ''
    bookingError.value = ''
    flight.value = null
    passengers.value = boundedInteger(route.query.passengers, 1, 9)
    try {
      const result = await getFlight(String(route.params.flightId), controller.signal)
      if (!controller.signal.aborted) flight.value = result
    } catch (reason) {
      if (!controller.signal.aborted) error.value = (reason as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

async function confirmBooking() {
  if (!flight.value || booking.value) return
  if (!isBookable(flight.value, passengers.value)) {
    bookingError.value = 'This flight is no longer available for the selected travelers.'
    return
  }
  const attempt = bookingAttempt(readPending(), flight.value.id, passengers.value)
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(attempt))
  booking.value = true
  bookingError.value = ''
  try {
    const result = await createBooking(attempt.flightId, attempt.seatCount, attempt.idempotencyKey)
    sessionStorage.removeItem(PENDING_KEY)
    await router.replace({ path: `/trips/${result.booking.id}`, query: { created: '1' } })
  } catch (reason) {
    bookingError.value = (reason as Error).message
  } finally {
    booking.value = false
  }
}
</script>

<template>
  <AppShell>
    <p v-if="loading" class="state-message">Loading flight…</p>
    <div v-else-if="error" class="state-message state-message--error">
      <p>{{ error }}</p>
      <button class="button button--outline" type="button" @click="reload++">Try again</button>
    </div>
    <section v-else-if="flight" class="details-layout">
      <div>
        <button class="back-link" type="button" @click="router.back()">← Back to results</button>
        <h1>{{ flight.flightNumber }} · {{ flight.airline.name }}</h1>
        <span
          class="status"
          :class="{
            'status--confirmed': flight.status === 'SCHEDULED',
            'status-delayed': flight.status === 'DELAYED',
            'status--cancelled': flight.status === 'CANCELLED',
          }"
        >
          {{ flight.status.charAt(0) + flight.status.slice(1).toLowerCase() }}
        </span>
        <div class="itinerary-card">
          <div>
            <strong>
              {{ formatTime(flight.departureAt, flight.originAirport.timezone) }}
            </strong>
            <b>{{ flight.originAirport.iataCode }}</b>
            <span>{{ flight.originAirport.name }}</span>
          </div>
          <div class="itinerary-line">
            <span>{{ formatDuration(flight.durationMinutes) }} · Nonstop</span>
            <i></i>
            <span>{{ formatFlightDate(flight.departureAt, flight.originAirport.timezone) }}</span>
          </div>
          <div>
            <strong>
              {{ formatTime(flight.arrivalAt, flight.destinationAirport.timezone) }}
            </strong>
            <b>{{ flight.destinationAirport.iataCode }}</b>
            <span>{{ flight.destinationAirport.name }}</span>
          </div>
        </div>
        <section class="detail-panel">
          <h2>Flight details</h2>
          <dl>
            <div>
              <dt>Current departure</dt>
              <dd>{{ formatTime(flight.departureAt, flight.originAirport.timezone) }}</dd>
            </div>
            <div v-if="flight.scheduleChanged">
              <dt>Originally scheduled</dt>
              <dd>{{ formatTime(flight.scheduledDepartureAt, flight.originAirport.timezone) }}</dd>
            </div>
            <div>
              <dt>Current arrival</dt>
              <dd>{{ formatTime(flight.arrivalAt, flight.destinationAirport.timezone) }}</dd>
            </div>
            <div v-if="flight.scheduleChanged">
              <dt>Original arrival</dt>
              <dd>
                {{
                  formatFlightDate(flight.scheduledArrivalAt, flight.destinationAirport.timezone)
                }}
                · {{ formatTime(flight.scheduledArrivalAt, flight.destinationAirport.timezone) }}
              </dd>
            </div>
            <div>
              <dt>Available seats</dt>
              <dd>{{ flight.availableSeats }}</dd>
            </div>
            <div>
              <dt>Price per traveler</dt>
              <dd>{{ formatMoney(flight.price.amount, flight.price.currency) }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <aside class="booking-review">
        <h2>Review booking</h2>
        <label>
          Travelers
          <select v-model.number="passengers" :disabled="booking">
            <option v-for="count in 9" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
        <div class="booking-line">
          <span>
            {{ passengers }} traveler{{ passengers === 1 ? '' : 's' }} ×
            {{ formatMoney(flight.price.amount, flight.price.currency) }}
          </span>
          <span>{{ formatMoney(totalAmount, flight.price.currency) }}</span>
        </div>
        <div class="booking-total">
          <strong>Total</strong>
          <strong>{{ formatMoney(totalAmount, flight.price.currency) }}</strong>
        </div>
        <p v-if="bookingError" class="form-error" role="alert">
          {{ bookingError }} You can safely retry this booking.
        </p>
        <p v-if="!isBookable(flight, passengers)" class="form-error" role="status">
          This flight is unavailable for the selected travelers.
        </p>
        <button
          class="button button--wide"
          type="button"
          :disabled="booking || !isBookable(flight, passengers)"
          @click="confirmBooking"
        >
          {{ booking ? 'Confirming…' : 'Confirm booking' }}
        </button>
        <p class="booking-note">No payment is collected. This is a simulated booking.</p>
        <button class="link-button" type="button" @click="router.back()">Cancel</button>
      </aside>
    </section>
  </AppShell>
</template>
