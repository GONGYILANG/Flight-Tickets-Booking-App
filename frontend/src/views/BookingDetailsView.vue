<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { cancelBooking, getBooking } from '../api'
import { formatDuration, formatFlightDate, formatMoney, formatTime } from '../lib'
import type { Booking } from '../types'

const route = useRoute()
const booking = ref<Booking | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const loading = ref(true)
const cancelling = ref(false)
const error = ref('')
const cancelError = ref('')
const reload = ref(0)
const notice = ref(route.query.created === '1' ? 'Booking confirmed.' : '')

watch([() => route.params.bookingId, reload], async (_value, _old, cleanup) => {
  const controller = new AbortController()
  cleanup(() => controller.abort())
  loading.value = true
  error.value = ''
  cancelError.value = ''
  booking.value = null
  dialog.value?.close()
  notice.value = route.query.created === '1' ? 'Booking confirmed.' : ''
  try {
    const result = await getBooking(String(route.params.bookingId), controller.signal)
    if (!controller.signal.aborted) booking.value = result
  } catch (reason) {
    if (!controller.signal.aborted) error.value = (reason as Error).message
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}, { immediate: true })

async function confirmCancel() {
  if (!booking.value || cancelling.value) return
  cancelling.value = true
  cancelError.value = ''
  try {
    const result = await cancelBooking(booking.value.id)
    booking.value = result.booking
    notice.value = result.alreadyCancelled ? 'This booking was already cancelled.' : 'Booking cancelled.'
    dialog.value?.close()
  } catch (reason) {
    cancelError.value = (reason as Error).message
  } finally {
    cancelling.value = false
  }
}

</script>

<template>
  <AppShell>
    <p v-if="loading" class="state-message">Loading booking…</p>
    <div v-else-if="error && !booking" class="state-message state-message--error"><p>{{ error }}</p><button class="button button--outline" type="button" @click="reload++">Try again</button></div>
    <section v-else-if="booking" class="booking-page">
      <RouterLink class="back-link" to="/trips">← Back to my trips</RouterLink>
      <div class="booking-heading"><h1>Booking {{ booking.bookingReference }}</h1><span class="status" :class="booking.status === 'CONFIRMED' ? 'status--confirmed' : 'status--cancelled'">{{ booking.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled' }}</span></div>
      <p v-if="notice" class="success-message" role="status">{{ notice }}</p>
      <div class="booking-summary"><div><strong>{{ booking.flight.flightNumber }} · {{ booking.flight.airline.name }}</strong><b>{{ formatTime(booking.flight.departureAt, booking.flight.originAirport.timezone) }} {{ booking.flight.originAirport.iataCode }} → {{ formatTime(booking.flight.arrivalAt, booking.flight.destinationAirport.timezone) }} {{ booking.flight.destinationAirport.iataCode }}</b><span>{{ formatFlightDate(booking.flight.departureAt, booking.flight.originAirport.timezone) }}</span></div><div><span>Travelers</span><strong>{{ booking.seatCount }}</strong></div><div><span>Total</span><strong>{{ formatMoney(booking.pricing.totalAmount, booking.pricing.currency) }}</strong></div><div><span>Booked via</span><strong>{{ booking.source === 'AI' ? 'AI' : 'Web' }}</strong></div><button v-if="booking.status === 'CONFIRMED'" class="button button--danger-outline" type="button" @click="dialog?.showModal()">Cancel booking</button></div>
      <section class="booking-section"><h2>Itinerary</h2><div class="booking-itinerary"><div><strong>{{ formatTime(booking.flight.departureAt, booking.flight.originAirport.timezone) }}</strong><span>{{ formatFlightDate(booking.flight.departureAt, booking.flight.originAirport.timezone) }}</span><b>{{ booking.flight.originAirport.name }}</b><small>{{ booking.flight.originAirport.iataCode }} · {{ booking.flight.originAirport.cityName }}</small></div><i><span>{{ formatDuration(booking.flight.durationMinutes) }} · Direct</span></i><div><strong>{{ formatTime(booking.flight.arrivalAt, booking.flight.destinationAirport.timezone) }}</strong><span>{{ formatFlightDate(booking.flight.arrivalAt, booking.flight.destinationAirport.timezone) }}</span><b>{{ booking.flight.destinationAirport.name }}</b><small>{{ booking.flight.destinationAirport.iataCode }} · {{ booking.flight.destinationAirport.cityName }}</small></div></div></section>
      <section class="booking-section"><h2>Booking details</h2><dl><div><dt>Price per traveler</dt><dd>{{ formatMoney(booking.pricing.unitAmount, booking.pricing.currency) }}</dd></div><div><dt>Created</dt><dd>{{ new Date(booking.createdAt).toLocaleString('en-US') }}</dd></div><div v-if="booking.cancelledAt"><dt>Cancelled</dt><dd>{{ new Date(booking.cancelledAt).toLocaleString('en-US') }}</dd></div></dl></section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </section>
    <dialog ref="dialog" class="confirm-dialog" aria-labelledby="cancel-title" aria-describedby="cancel-description" @click.self="!cancelling && dialog?.close()" @cancel="cancelling && $event.preventDefault()"><h2 id="cancel-title">Cancel this booking?</h2><p id="cancel-description">This will cancel booking {{ booking?.bookingReference }} and release {{ booking?.seatCount }} seat{{ booking?.seatCount === 1 ? '' : 's' }}. This action cannot be undone.</p><p v-if="cancelError" class="form-error" role="alert">{{ cancelError }}</p><div><button class="button button--outline" type="button" autofocus :disabled="cancelling" @click="dialog?.close()">Keep booking</button><button class="button button--danger" type="button" :disabled="cancelling" @click="confirmCancel">{{ cancelling ? 'Cancelling…' : 'Cancel booking' }}</button></div></dialog>
  </AppShell>
</template>
