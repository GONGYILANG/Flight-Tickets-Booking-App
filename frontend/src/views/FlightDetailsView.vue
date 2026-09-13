<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElForm,
  ElFormItem,
  ElOption,
  ElSelect,
  ElSkeleton,
  ElTag,
} from 'element-plus'
import { ArrowLeft, ChevronDown, LoaderCircle } from 'lucide-vue-next'
import FlightItinerary from '../components/FlightItinerary.vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { createBooking, getFlight } from '../api'
import {
  amountToCents,
  bookingAttempt,
  boundedInteger,
  centsToAmount,
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
  <AppShell wide>
    <div v-if="loading" class="py-8" role="status">
      <p class="mb-4 text-slate-500">Loading flight…</p>
      <ElSkeleton :rows="5" animated />
    </div>
    <div v-else-if="error" class="grid gap-4">
      <ElAlert :title="error" type="error" :closable="false" role="alert" />
      <ElButton
        class="justify-self-start"
        @click="reload++"
      >Try again
      </ElButton>
    </div>
    <section v-else-if="flight" class="grid gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
      <div class="min-w-0 space-y-6">
        <ElButton link type="primary" :icon="ArrowLeft" @click="router.back()">
          Back to results
        </ElButton>
        <div>
          <h1 class="mb-3 text-2xl font-semibold tracking-tight">
            {{ flight.flightNumber }} · {{ flight.airline.name }}
          </h1>
          <ElTag
            :type="
              flight.status === 'DELAYED'
                ? 'warning'
                : flight.status === 'CANCELLED'
                  ? 'danger'
                  : 'success'
            "
          >{{ flight.status.charAt(0) + flight.status.slice(1).toLowerCase() }}
          </ElTag>
        </div>
        <FlightItinerary :flight="flight" />
        <section class="rounded-xl border border-slate-200 p-5 sm:p-6">
          <h2 class="mb-5 text-lg font-semibold">Flight details</h2>
          <ElDescriptions :column="1" border label-width="160">
            <ElDescriptionsItem label="Current departure">
              {{formatTime(flight.departureAt, flight.originAirport.timezone)}}
            </ElDescriptionsItem>
            <ElDescriptionsItem v-if="flight.scheduleChanged" label="Originally scheduled">
              {{ formatFlightDate(flight.scheduledDepartureAt, flight.originAirport.timezone) }}
               · {{formatTime(flight.scheduledDepartureAt, flight.originAirport.timezone)}}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="Current arrival">
              {{formatTime(flight.arrivalAt, flight.destinationAirport.timezone)}}
            </ElDescriptionsItem>
            <ElDescriptionsItem v-if="flight.scheduleChanged" label="Original arrival">
              {{formatFlightDate(flight.scheduledArrivalAt, flight.destinationAirport.timezone)}}
              · {{formatTime(flight.scheduledArrivalAt, flight.destinationAirport.timezone)}}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="Available seats">
              {{flight.availableSeats}}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="Price per traveler">
              {{formatMoney(flight.price.amount, flight.price.currency)}}
            </ElDescriptionsItem>
          </ElDescriptions>
        </section>
      </div>
      <aside class="self-start rounded-xl border border-slate-200 p-5 sm:p-6">
        <h2 class="mb-6 text-xl font-semibold">Review booking</h2>
        <ElForm label-position="top" @submit.prevent="confirmBooking">
          <ElFormItem label="Travelers">
            <ElSelect
              v-model="passengers"
              aria-label="Travelers"
              :disabled="booking"
              :suffix-icon="ChevronDown"
            >
              <ElOption v-for="count in 9" :key="count" :value="count" :label="String(count)"/>
            </ElSelect>
          </ElFormItem>
          <div class="flex flex-wrap justify-between gap-3 border-y border-slate-200 py-5 text-sm">
            <span>{{ passengers }} travelers ×
              {{ formatMoney(flight.price.amount, flight.price.currency) }}
            </span>
            <span>{{ formatMoney(totalAmount, flight.price.currency) }}</span>
          </div>
          <div class="my-6 flex justify-between gap-3 text-lg font-semibold">
            <span>Total</span>
            <span class="text-teal-700">
              {{formatMoney(totalAmount, flight.price.currency)}}
            </span>
          </div>
          <ElAlert
            v-if="bookingError"
            :title="`${bookingError} You can safely retry this booking.`"
            type="error"
            :closable="false"
            class="mb-4"
            role="alert"
          />
          <ElAlert
            v-if="!isBookable(flight, passengers)"
            title="This flight is unavailable for the selected travelers."
            type="warning"
            :closable="false"
            class="mb-4"
          />
          <ElButton
            type="primary"
            native-type="submit"
            class="w-full"
            :loading="booking"
            :loading-icon="LoaderCircle"
            :disabled="booking || !isBookable(flight, passengers)"
          >{{ booking ? 'Confirming…' : 'Confirm booking' }}
          </ElButton>
        </ElForm>
        <p class="my-5 text-center text-xs leading-5 text-slate-500">
          No payment is collected. This is a simulated booking.
        </p>
        <div class="text-center">
          <ElButton link type="primary" @click="router.back()">Cancel</ElButton>
        </div>
      </aside>
    </section>
  </AppShell>
</template>
