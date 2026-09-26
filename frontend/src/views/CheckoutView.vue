<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElProgress,
  ElSkeleton,
  ElStep,
  ElSteps,
} from 'element-plus'
import {
  Armchair,
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  LoaderCircle,
  Users,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { createBooking, getFlight } from '../api'
import { demoSeatRows, toggleDemoSeat } from '../checkout'
import {
  amountToCents,
  bookingAttempt,
  boundedInteger,
  centsToAmount,
  formatFlightDate,
  formatMoney,
  isBookable,
  type PendingBooking,
} from '../lib'
import { useAuthStore } from '../stores/auth'
import type { Flight } from '../types'

const PENDING_KEY = 'flight-booking-pending-booking'
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const flight = ref<Flight | null>(null)
const passengers = computed(() => boundedInteger(route.query.passengers, 1, 9))
const selected = ref<string[]>([])
const stage = ref<'seats' | 'holding' | 'payment'>('seats')
const progress = ref(0)
const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const paymentError = ref('')
const reload = ref(0)
const pending = ref<PendingBooking | null>(null)
const heading = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
let completionTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let active = true

const retrying = computed(() =>
  pending.value?.flightId === flight.value?.id && pending.value?.seatCount === passengers.value,
)
const available = computed(() =>
  Boolean((flight.value && (isBookable(flight.value, passengers.value)) || retrying.value)),
)
const rows = computed(() =>
  flight.value
    ? demoSeatRows(
        flight.value.totalSeats,
        retrying.value
          ? Math.max(passengers.value, flight.value.availableSeats)
          : flight.value.availableSeats,
      )
    : [],
)
const total = computed(() =>
  centsToAmount(amountToCents(flight.value?.price.amount ?? '0.00') * passengers.value),
)
const validSelection = computed(
  () =>
    selected.value.length === passengers.value &&
    new Set(selected.value).size === selected.value.length &&
    selected.value.every((id) =>
      rows.value.flat().some((seat) => seat.id === id && seat.available),
    ),
)
const backToFlight = computed(() => ({
  path: `/flights/${route.params.flightId}`,
  query: { passengers: passengers.value },
}))

function readPending(): PendingBooking | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null')
    if (
      typeof value?.flightId === 'string' &&
      Number.isInteger(value.seatCount) &&
      value.seatCount >= 1 &&
      value.seatCount <= 9 &&
      typeof value.idempotencyKey === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value.idempotencyKey,
      )
    )
      return value
  } catch {
    /* A malformed local draft cannot be reused. */
  }
  return null
}

function stopProgress() {
  clearInterval(timer)
  clearTimeout(completionTimer)
}

watch(stage, async (value) => {
  if (value === 'holding') return
  await nextTick()
  if (!active) return
  window.scrollTo({ top: 0, behavior: 'auto' })
  heading.value?.focus({ preventScroll: true })
})

watch(
  [() => route.params.flightId, passengers, reload],
  async (_value, _old, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    generation++
    stopProgress()
    selected.value = []
    stage.value = 'seats'
    progress.value = 0
    loading.value = true
    error.value = ''
    paymentError.value = ''
    submitting.value = false
    flight.value = null
    pending.value = readPending()
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

function confirmSeats() {
  if (stage.value !== 'seats' || !validSelection.value || !available.value) return
  stage.value = 'holding'
  progress.value = 0
  // This animation never reserves server inventory; the booking API runs only at payment.
  timer = setInterval(() => {
    progress.value = Math.min(100, progress.value + 10)
    if (progress.value === 100) {
      clearInterval(timer)
      completionTimer = setTimeout(() => {
        stage.value = 'payment'
      }, 300)
    }
  }, 220)
}

async function pay() {
  if (stage.value !== 'payment' || submitting.value || !flight.value || !validSelection.value)
    return
  if (!available.value) {
    paymentError.value = 'This flight is no longer available. Please return to the search results.'
    return
  }
  const scope = generation
  const owner = auth.user?.id
  const attempt = bookingAttempt(readPending(), flight.value.id, passengers.value)
  submitting.value = true
  paymentError.value = ''
  try {
    // Persist the key before writing so a timeout or refresh can safely retry the same booking.
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(attempt))
    pending.value = attempt
    const result = await createBooking(attempt.flightId, attempt.seatCount, attempt.idempotencyKey)
    if (!active || scope !== generation || owner !== auth.user?.id) return
    const failure = await router.replace({ path: '/trips', query: { created: result.booking.id } })
    if (
      !failure &&
      owner === auth.user?.id &&
      readPending()?.idempotencyKey === attempt.idempotencyKey
    ) {
      sessionStorage.removeItem(PENDING_KEY)
    }
  } catch (reason) {
    if (active && scope === generation && owner === auth.user?.id)
      paymentError.value = (reason as Error).message
  } finally {
    if (scope === generation) submitting.value = false
  }
}

onBeforeUnmount(() => {
  active = false
  generation++
  stopProgress()
})
</script>

<template>
  <AppShell>
    <div v-if="loading" role="status">
      <p class="mb-4 text-slate-500">Loading checkout…</p>
      <ElSkeleton :rows="6" animated />
    </div>
    <div v-else-if="error" class="grid gap-4">
      <ElAlert :title="error" type="error" :closable="false" role="alert" />
      <ElButton class="justify-self-start" @click="reload++">Try again</ElButton>
    </div>
    <section v-else-if="flight" class="pb-32 lg:pb-0">
      <ElButton
        link
        type="primary"
        :icon="ArrowLeft"
        :disabled="submitting"
        @click="router.push(backToFlight)"
        >Back to flight</ElButton
      >
      <h1 ref="heading" tabindex="-1" class="mt-4 text-[28px] font-semibold tracking-tight">
        {{ stage === 'payment' ? 'Simulated payment' : 'Choose your seats' }}
      </h1>
      <p class="mt-2 text-sm text-slate-500">
        {{
          stage === 'payment'
            ? 'Review your trip and finish this demo booking.'
            : `Select ${passengers} seat${passengers === 1 ? '' : 's'} for your trip.`
        }}
      </p>
      <ElSteps
        :active="stage === 'seats' ? 0 : stage === 'holding' ? 1 : 2"
        finish-status="finish"
        align-center
        class="my-7 [&_.is-process]:text-blue-700! [&_.is-process]:border-blue-700!"
      >
        <ElStep title="Seats" :icon="Armchair" /><ElStep
          title="Reserve"
          :icon="LoaderCircle"
        /><ElStep title="Payment" :icon="CreditCard" />
      </ElSteps>
      <ElAlert
        v-if="!available"
        title="This flight is unavailable for the selected travelers."
        type="warning"
        :closable="false"
        class="mb-5"
      />
      <ElAlert
        v-if="retrying"
        title="An earlier booking attempt has not been confirmed. Retrying uses the same booking request."
        type="info"
        :closable="false"
        class="mb-5"
      />
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <section
          v-if="stage !== 'payment'"
          class="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <h2 class="text-lg font-semibold">Demo cabin</h2>
          <p class="mt-2 text-xs leading-5 text-slate-500">
            Illustrative seat map. Seats are not assigned by the airline.
          </p>
          <div class="mx-auto mt-5 max-w-sm">
            <div
              class="grid grid-cols-7 gap-1.5 pb-2 text-center text-xs text-slate-500"
              aria-hidden="true"
            >
              <span v-for="letter in ['A', 'B', 'C', '', 'D', 'E', 'F']" :key="letter">{{
                letter
              }}</span>
            </div>
            <div
              class="max-h-[min(360px,45dvh)] overflow-y-auto overscroll-contain pr-1 sm:max-h-[400px]"
              role="group"
              aria-label="Demo seat map"
            >
              <div
                v-for="(row, rowIndex) in rows"
                :key="rowIndex"
                class="mb-2 grid grid-cols-7 gap-1.5"
              >
                <template v-for="(seat, column) in row" :key="seat.id">
                  <span
                    v-if="column === 3"
                    class="self-center text-center text-xs text-slate-400"
                    aria-hidden="true"
                    >{{ rowIndex + 1 }}</span
                  >
                  <ElButton
                    class="m-0! h-12! min-w-0! px-0! [&>span]:flex-col [&>span]:gap-1 [&>span]:text-[10px]"
                    :type="selected.includes(seat.id) ? 'primary' : 'default'"
                    :disabled="
                      !available ||
                      !seat.available ||
                      stage !== 'seats' ||
                      (!selected.includes(seat.id) && selected.length >= passengers)
                    "
                    :aria-label="`Seat ${seat.id}${!seat.available ? ', unavailable' : ''}`"
                    :aria-pressed="selected.includes(seat.id)"
                    @click="selected = toggleDemoSeat(selected, seat, passengers)"
                    ><component
                      :is="!seat.available ? X : selected.includes(seat.id) ? Check : Armchair"
                      :size="16"
                      aria-hidden="true"
                    />{{ seat.id }}</ElButton
                  >
                </template>
              </div>
            </div>
          </div>
          <div
            class="mt-5 flex flex-wrap justify-center gap-4 border-t border-slate-200 pt-4
             text-xs text-slate-500"
          >
            <span class="inline-flex items-center gap-1.5"
              ><Armchair :size="15" aria-hidden="true" />Available</span
            >
            <span class="inline-flex items-center gap-1.5 text-blue-700"
              ><Check :size="15" aria-hidden="true" />Selected</span
            >
            <span class="inline-flex items-center gap-1.5"
              ><X :size="15" aria-hidden="true" />Unavailable</span
            >
          </div>
        </section>
        <section v-else class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 class="flex items-center gap-3 text-lg font-semibold">
            <CreditCard :size="24" aria-hidden="true" />Demo payment
          </h2>
          <div
            class="mx-auto my-8 grid aspect-[1.8] w-full max-w-sm content-between rounded-xl
             bg-[#10233f] p-6 text-[#fff] shadow-lg shadow-slate-900/10"
            aria-label="Demo card ending in 4242"
          >
            <span class="text-xs tracking-widest text-blue-100">DEMO CARD</span>
            <span class="text-2xl tracking-wider">•••• 4242</span>
          </div>
          <p class="mb-8 text-center text-sm text-slate-500">
            No card details or real payment are required.
          </p>
          <ElAlert
            title="Demo seat selection complete"
            :description="`Selected seats: ${selected.join(', ')}`"
            type="success"
            :closable="false"
            :show-icon="true"
          />
        </section>
        <aside class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 class="text-lg font-semibold">Trip summary</h2>
          <p class="mt-5 text-sm font-medium">
            {{ flight.flightNumber }} · {{ flight.airline.name }}
          </p>
          <p class="my-4 flex items-center gap-3 text-2xl font-semibold">
            {{ flight.originAirport.iataCode }}<ArrowRight :size="20" aria-hidden="true" />{{
              flight.destinationAirport.iataCode
            }}
          </p>
          <p class="text-sm text-slate-500">
            {{ formatFlightDate(flight.departureAt, flight.originAirport.timezone) }}
          </p>
          <div class="my-5 space-y-4 border-y border-slate-200 py-5 text-sm">
            <p class="flex items-center gap-2">
              <Users :size="18" aria-hidden="true" />{{ passengers }} traveler{{
                passengers === 1 ? '' : 's'
              }}
            </p>
            <p class="flex items-start gap-2">
              <Armchair :size="18" class="shrink-0" aria-hidden="true" /><span
                >Selected seats: <strong>{{ selected.join(', ') || 'None yet' }}</strong></span
              >
            </p>
            <p v-if="stage === 'seats'" class="text-xs text-slate-500" role="status">
              {{ selected.length }} of {{ passengers }} seats selected
            </p>
          </div>
          <div class="mb-6 flex justify-between gap-3 text-lg font-semibold">
            <span>Total</span
            ><span class="text-blue-700">{{ formatMoney(total, flight.price.currency) }}</span>
          </div>
          <ElAlert
            v-if="paymentError"
            :title="paymentError"
            description="You can safely retry the same booking, or check My trips if the result is uncertain."
            type="error"
            :closable="false"
            role="alert"
            class="mb-4"
          />
          <div v-if="stage === 'seats'" class="grid gap-3">
            <ElButton
              class="hidden! lg:inline-flex!"
              type="primary"
              :disabled="!validSelection || !available"
              @click="confirmSeats"
              >Confirm seats</ElButton
            >
            <ElButton class="m-0!" @click="router.push(backToFlight)">Cancel</ElButton>
          </div>
          <ElForm v-else-if="stage === 'payment'" class="grid gap-3" @submit.prevent="pay">
            <ElButton
              type="primary"
              native-type="submit"
              class="hidden! lg:inline-flex!"
              :loading="submitting"
              :loading-icon="LoaderCircle"
              :disabled="submitting || !validSelection || !available"
              >{{ submitting ? 'Confirming booking…' : 'Complete simulated payment' }}</ElButton
            >
            <ElButton class="m-0!" :disabled="submitting" @click="stage = 'seats'"
              >Change seats</ElButton
            >
            <RouterLink
              v-if="paymentError"
              class="text-center text-sm text-blue-700 underline"
              to="/trips"
              >Check My trips</RouterLink
            >
          </ElForm>
          <p class="mt-5 text-xs leading-5 text-slate-500">
            Seat selection and payment are simulated. No money is charged. Your booking is created
            when you finish payment.
          </p>
        </aside>
      </div>
      <div
        v-if="stage !== 'holding'"
        class="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between gap-3
         border-t border-slate-200 bg-white p-4 shadow-lg max-[380px]:[&>button]:w-full lg:hidden"
      >
        <div class="min-w-0 text-xs text-slate-500" role="status">
          <p>{{ selected.length }} / {{ passengers }} seats selected</p>
          <strong class="mt-1 block text-sm text-blue-700">{{
            formatMoney(total, flight.price.currency)
          }}</strong>
        </div>
        <ElButton
          v-if="stage === 'seats'"
          type="primary"
          :disabled="!validSelection || !available"
          @click="confirmSeats"
          >Confirm seats</ElButton
        >
        <ElButton
          v-else
          type="primary"
          :loading="submitting"
          :loading-icon="LoaderCircle"
          :disabled="submitting || !validSelection || !available"
          @click="pay"
          >{{ submitting ? 'Confirming…' : 'Complete simulated payment' }}</ElButton
        >
      </div>
    </section>
    <ElDialog
      :model-value="stage === 'holding'"
      title="Reserving demo seats…"
      width="min(440px, calc(100vw - 32px))"
      align-center
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <p class="mb-5 text-sm text-slate-500">Selected seats: {{ selected.join(', ') }}</p>
      <ElProgress
        :percentage="progress"
        :stroke-width="10"
        aria-label="Simulated seat reservation progress"
      />
      <p class="mt-5 text-xs leading-5 text-slate-500" role="status">
        Simulation only. Availability is checked when you finish booking.
      </p>
    </ElDialog>
  </AppShell>
</template>
