<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { listBookings } from '../api'
import { boundedInteger, formatFlightDate, formatMoney, formatTime } from '../lib'
import type { Booking, Pagination } from '../types'

const route = useRoute()
const router = useRouter()
const bookings = ref<Booking[]>([])
const pagination = ref<Pagination>({ page: 1, limit: 20, totalItems: 0, totalPages: 0 })
const loading = ref(true)
const error = ref('')
const reload = ref(0)

watch(
  [() => route.query.page, reload],
  async (_value, _old, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    loading.value = true
    error.value = ''
    try {
      const result = await listBookings(
        boundedInteger(route.query.page, 1, 10000),
        20,
        controller.signal,
      )
      if (controller.signal.aborted) return
      bookings.value = result.bookings
      pagination.value = result.pagination
    } catch (reason) {
      if (!controller.signal.aborted) error.value = (reason as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

function go(page: number) {
  void router.replace({ query: { page } })
}
</script>

<template>
  <AppShell>
    <section class="trips-page">
      <h1>My trips</h1>
      <p class="page-subtitle">Your simulated bookings</p>
      <div class="trips-toolbar">
        <span>Newest first</span>
        <span>
          {{ pagination.totalItems }} booking{{ pagination.totalItems === 1 ? '' : 's' }}
        </span>
      </div>
      <p v-if="loading" class="state-message">Loading bookings…</p>
      <div v-else-if="error" class="state-message state-message--error">
        <p>{{ error }}</p>
        <button class="button button--outline" type="button" @click="reload++">Try again</button>
      </div>
      <div v-else-if="!bookings.length" class="state-message">
        <h2>No bookings yet</h2>
        <RouterLink class="button" to="/flights">Search flights</RouterLink>
      </div>
      <div v-else class="trips-table-wrap">
        <table class="trips-table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Flight</th>
              <th>Date & route</th>
              <th>Travelers</th>
              <th>Total</th>
              <th>Source</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in bookings" :key="item.id">
              <td>
                <strong>{{ item.bookingReference }}</strong>
              </td>
              <td>{{ item.flight.flightNumber }}</td>
              <td>
                <strong>
                  {{formatFlightDate(item.flight.departureAt, item.flight.originAirport.timezone)}}
                </strong>
                <span>
                  {{ formatTime(item.flight.departureAt, item.flight.originAirport.timezone) }}
                  {{ item.flight.originAirport.iataCode }} →
                  {{ formatTime(item.flight.arrivalAt, item.flight.destinationAirport.timezone) }}
                  {{ item.flight.destinationAirport.iataCode }}
                </span>
              </td>
              <td>{{ item.seatCount }} traveler{{ item.seatCount === 1 ? '' : 's' }}</td>
              <td>{{ formatMoney(item.pricing.totalAmount, item.pricing.currency) }}</td>
              <td>Booked via {{ item.source === 'AI' ? 'AI' : 'Web' }}</td>
              <td>
                <span
                  class="status"
                  :class="item.status === 'CONFIRMED' ? 'status--confirmed' : 'status--cancelled'"
                >
                  {{ item.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled' }}
                </span>
              </td>
              <td>
                <RouterLink :to="`/trips/${item.id}`">View details</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav
        v-if="!loading && !error && pagination.totalPages"
        class="pagination"
        aria-label="Booking pages"
      >
        <button type="button" :disabled="pagination.page <= 1" @click="go(pagination.page - 1)">
          Previous
        </button>
        <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button
          type="button"
          :disabled="pagination.page >= pagination.totalPages"
          @click="go(pagination.page + 1)"
        >
          Next
        </button>
      </nav>
    </section>
  </AppShell>
</template>
