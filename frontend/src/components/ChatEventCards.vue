<script setup lang="ts">
import { ElAlert, ElButton, ElTag } from 'element-plus'
import { ArrowRight, ChevronRight } from 'lucide-vue-next'
import FlightTable from './FlightTable.vue'
import { RouterLink, useRouter } from 'vue-router'
import { computed } from 'vue'
import { amountToCents, centsToAmount, formatFlightDate, formatMoney, formatTime } from '../lib'
import type { Airport, Booking, ChatEvent, Flight } from '../types'

const props = defineProps<{ events: ChatEvent[]; passengers: number; interactive: boolean }>()
const emit = defineEmits<{ quick: [string] }>()
const router = useRouter()

const hasBooking = computed(() =>
  props.events.some((event) => event.tool === 'create_booking' && event.result.ok),
)
function airportGroups(event: ChatEvent) {
  const groups = new Map<string, Airport[]>()
  for (const airport of (event.result.data?.airports ?? []) as Airport[]) {
    const key = `${airport.cityName}, ${airport.countryCode}`
    const group = groups.get(key) ?? []
    group.push(airport)
    groups.set(key, group)
  }
  return [...groups].map(([city, airports]) => ({ city, airports }))
}
const flights = (event: ChatEvent) => (event.result.data?.flights ?? []) as Flight[]
const flight = (event: ChatEvent) => event.result.data?.flight as unknown as Flight | undefined
const booking = (event: ChatEvent) => event.result.data?.booking as unknown as Booking | undefined
const bookings = (event: ChatEvent) => (event.result.data?.bookings ?? []) as Booking[]
</script>

<template>
  <div class="grid w-full min-w-0 gap-3">
    <template v-for="(event, eventIndex) in events" :key="`${event.tool}-${eventIndex}`">
      <ElAlert
        v-if="!event.result.ok"
        :title="event.result.error?.message ?? 'The request failed.'"
        type="error"
        :closable="false"
        role="alert"
      />
      <template v-else-if="event.tool === 'search_airports'">
        <section
          v-for="group in airportGroups(event)"
          :key="group.city"
          class="grid gap-2"
          :aria-label="`${group.city} airports`"
        >
          <h3 class="text-xs font-medium text-slate-500">{{ group.city }}</h3>
          <div class="flex flex-wrap gap-2">
            <ElButton
              v-for="airport in group.airports"
              :key="airport.id"
              class="m-0! h-auto! min-h-10 max-w-full py-2! text-left! [&>span]:whitespace-normal"
              :disabled="!interactive"
              @click="emit('quick', `Use ${airport.name} (${airport.iataCode}).`)"
              >{{ airport.iataCode }} · {{ airport.name }}</ElButton
            >
          </div>
        </section>
      </template>
      <div v-else-if="event.tool === 'search_flights'" class="min-w-0">
        <FlightTable
          :flights="flights(event)"
          :passengers="passengers"
          selectable
          :disabled="!interactive"
          @select="
            (item) =>
              emit(
                'quick',
                `Review ${item.flightNumber} (${item.id}) departing ${item.departureAt} for ${passengers} travelers. Do not book yet.`,
              )
          "
        />
      </div>
      <div
        v-else-if="event.tool === 'get_flight' && flight(event)"
        class="grid justify-items-start gap-3 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 p-5 text-sm"
      >
        <strong>{{ flight(event)?.flightNumber }} · {{ flight(event)?.airline.name }}</strong>
        <span class="text-slate-500">{{
          formatFlightDate(flight(event)!.departureAt, flight(event)!.originAirport.timezone)
        }}</span>
        <span class="flex flex-wrap items-center gap-2"
          >{{ formatTime(flight(event)!.departureAt, flight(event)!.originAirport.timezone) }}
          {{ flight(event)?.originAirport.iataCode }}<ArrowRight :size="16" aria-hidden="true" />{{
            formatTime(flight(event)!.arrivalAt, flight(event)!.destinationAirport.timezone)
          }}
          {{ flight(event)?.destinationAirport.iataCode }}</span
        >
        <span
          >{{ passengers }} travelers · Total
          <strong class="text-blue-700">{{
            formatMoney(
              centsToAmount(amountToCents(flight(event)!.price.amount) * passengers),
              flight(event)!.price.currency,
            )
          }}</strong></span
        >
        <div v-if="!hasBooking && interactive" class="flex flex-wrap gap-3">
          <ElButton
            type="primary"
            class="m-0!"
            @click="
              router.push({ path: `/flights/${flight(event)!.id}/checkout`, query: { passengers } })
            "
            >Confirm booking</ElButton
          >
          <ElButton class="m-0!" @click="emit('quick', 'Show other flights for the same search.')"
            >Show other flights</ElButton
          >
        </div>
      </div>
      <div
        v-else-if="
          (event.tool === 'create_booking' || event.tool === 'cancel_booking') && booking(event)
        "
        class="grid justify-items-start gap-3 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 p-5 text-sm"
      >
        <ElTag :type="booking(event)?.status === 'CANCELLED' ? 'danger' : 'success'">{{
          booking(event)?.status === 'CANCELLED' ? 'Booking cancelled' : 'Booking confirmed'
        }}</ElTag>
        <strong>{{ booking(event)?.bookingReference }}</strong>
        <span>{{
          formatMoney(booking(event)!.pricing.totalAmount, booking(event)!.pricing.currency)
        }}</span>
        <RouterLink
          class="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
          :to="`/trips/${booking(event)?.id}`"
          >View booking<ChevronRight :size="16" aria-hidden="true"
        /></RouterLink>
      </div>
      <div
        v-else-if="event.tool === 'list_my_bookings'"
        class="grid gap-3 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 p-5 text-sm"
      >
        <RouterLink
          v-for="item in bookings(event)"
          :key="item.id"
          class="font-medium text-blue-700 hover:underline"
          :to="`/trips/${item.id}`"
          >{{ item.bookingReference }} · {{ item.flight.flightNumber }} ·
          {{ item.status.toLowerCase() }}</RouterLink
        >
        <p v-if="!bookings(event).length" class="text-slate-500">No bookings yet.</p>
      </div>
    </template>
  </div>
</template>
