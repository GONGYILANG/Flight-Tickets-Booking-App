<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElSkeleton,
  ElTag,
} from 'element-plus'
import { ArrowLeft, LoaderCircle, X } from 'lucide-vue-next'
import FlightItinerary from '../components/FlightItinerary.vue'
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { cancelBooking, getBooking } from '../api'
import { formatFlightDate, formatMoney } from '../lib'
import type { Booking } from '../types'

const route = useRoute()
const booking = ref<Booking | null>(null)
const dialogOpen = ref(false)
const loading = ref(true)
const cancelling = ref(false)
const error = ref('')
const cancelError = ref('')
const reload = ref(0)
const notice = ref(route.query.created === '1' ? 'Booking confirmed.' : '')

watch(
  [() => route.params.bookingId, reload],
  async (_value, _old, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    loading.value = true
    error.value = ''
    cancelError.value = ''
    booking.value = null
    dialogOpen.value = false
    notice.value = route.query.created === '1' ? 'Booking confirmed.' : ''
    try {
      const result = await getBooking(String(route.params.bookingId), controller.signal)
      if (!controller.signal.aborted) booking.value = result
    } catch (reason) {
      if (!controller.signal.aborted) error.value = (reason as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

async function confirmCancel() {
  if (!booking.value || cancelling.value) return
  cancelling.value = true
  cancelError.value = ''
  try {
    const result = await cancelBooking(booking.value.id)
    booking.value = result.booking
    notice.value = result.alreadyCancelled
      ? 'This booking was already cancelled.'
      : 'Booking cancelled.'
    dialogOpen.value = false
  } catch (reason) {
    cancelError.value = (reason as Error).message
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <AppShell wide>
    <div v-if="loading" class="py-8" role="status">
      <p class="mb-4 text-slate-500">Loading booking…</p>
      <ElSkeleton :rows="5" animated />
    </div>
    <div v-else-if="error && !booking" class="grid gap-4">
      <ElAlert :title="error" type="error" :closable="false" role="alert" /><ElButton
        class="justify-self-start"
        @click="reload++"
        >Try again</ElButton
      >
    </div>
    <section v-else-if="booking" class="space-y-6">
      <RouterLink
        class="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:underline"
        to="/trips"
        ><ArrowLeft :size="18" aria-hidden="true" />Back to my trips</RouterLink
      >
      <div class="flex flex-wrap items-center gap-4">
        <h1 class="text-2xl font-semibold tracking-tight break-all">
          Booking {{ booking.bookingReference }}
        </h1>
        <ElTag :type="booking.status === 'CONFIRMED' ? 'success' : 'danger'">{{
          booking.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'
        }}</ElTag>
      </div>
      <ElAlert v-if="notice" :title="notice" type="success" :closable="false" role="status" />
      <div
        class="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-slate-200 p-5 sm:p-6"
      >
        <div>
          <strong>{{ booking.flight.flightNumber }} · {{ booking.flight.airline.name }}</strong>
          <p class="mt-2 text-sm text-slate-500">
            {{
              formatFlightDate(booking.flight.departureAt, booking.flight.originAirport.timezone)
            }}
          </p>
        </div>
        <div class="space-y-2">
          <p class="text-xs text-slate-500">Travelers</p>
          <strong>{{ booking.seatCount }}</strong>
        </div>
        <div class="space-y-2">
          <p class="text-xs text-slate-500">Total</p>
          <strong class="text-base text-teal-700">{{
            formatMoney(booking.pricing.totalAmount, booking.pricing.currency)
          }}</strong>
        </div>
        <div class="space-y-2">
          <p class="text-xs text-slate-500">Booked via</p>
          <strong>{{ booking.source === 'AI' ? 'AI' : 'Web' }}</strong>
        </div>
        <ElButton
          v-if="booking.status === 'CONFIRMED'"
          type="danger"
          plain
          @click="dialogOpen = true"
          >Cancel booking</ElButton
        >
      </div>
      <section>
        <h2 class="mb-4 text-lg font-semibold">Itinerary</h2>
        <FlightItinerary :flight="booking.flight" />
      </section>
      <section class="rounded-xl border border-slate-200 p-5 sm:p-6">
        <h2 class="mb-5 text-lg font-semibold">Booking details</h2>
        <ElDescriptions :column="1" border label-width="160">
          <ElDescriptionsItem label="Price per traveler">{{
            formatMoney(booking.pricing.unitAmount, booking.pricing.currency)
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="Created">{{
            new Date(booking.createdAt).toLocaleString('en-US')
          }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="booking.cancelledAt" label="Cancelled">{{
            new Date(booking.cancelledAt).toLocaleString('en-US')
          }}</ElDescriptionsItem>
        </ElDescriptions>
      </section>
    </section>
    <ElDialog
      v-model="dialogOpen"
      title="Cancel this booking?"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-icon="X"
      :show-close="!cancelling"
      :close-on-click-modal="!cancelling"
      :close-on-press-escape="!cancelling"
    >
      <p class="text-sm leading-6 text-slate-600">
        This will cancel booking {{ booking?.bookingReference }} and release
        {{ booking?.seatCount }} seat{{ booking?.seatCount === 1 ? '' : 's' }}. This action cannot
        be undone.
      </p>
      <ElAlert
        v-if="cancelError"
        :title="cancelError"
        type="error"
        :closable="false"
        class="mt-4"
        role="alert"
      />
      <template #footer
        ><div class="flex flex-wrap justify-end gap-3">
          <ElButton :disabled="cancelling" @click="dialogOpen = false">Keep booking</ElButton
          ><ElButton
            type="danger"
            :loading="cancelling"
            :loading-icon="LoaderCircle"
            :disabled="cancelling"
            @click="confirmCancel"
            >{{ cancelling ? 'Cancelling…' : 'Cancel booking' }}</ElButton
          >
        </div></template
      >
    </ElDialog>
  </AppShell>
</template>
