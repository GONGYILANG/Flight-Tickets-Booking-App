<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { computed } from 'vue'
import { amountToCents, centsToAmount, formatDuration, formatFlightDate, formatMoney, formatTime } from '../lib'
import type { Airport, Booking, ChatEvent, Flight } from '../types'

const props = defineProps<{ events: ChatEvent[]; passengers: number; interactive: boolean }>()
const emit = defineEmits<{ quick: [string] }>()

const hasBooking = computed(() => props.events.some((event) => event.tool === 'create_booking' && event.result.ok))
const airports = (event: ChatEvent) => (event.result.data?.airports ?? []) as Airport[]
const flights = (event: ChatEvent) => (event.result.data?.flights ?? []) as Flight[]
const flight = (event: ChatEvent) => event.result.data?.flight as unknown as Flight | undefined
const booking = (event: ChatEvent) => event.result.data?.booking as unknown as Booking | undefined
const bookings = (event: ChatEvent) => (event.result.data?.bookings ?? []) as Booking[]
</script>

<template>
  <div class="chat-events">
    <template v-for="(event, eventIndex) in events" :key="`${event.tool}-${eventIndex}`">
      <p v-if="!event.result.ok" class="chat-event-error">{{ event.result.error?.message }}</p>
      <div v-else-if="event.tool === 'search_airports'" class="chat-options">
        <button
          v-for="airport in airports(event)"
          :key="airport.id"
          type="button"
          :disabled="!interactive"
          @click="emit('quick', `Use ${airport.name} (${airport.iataCode}).`)"
        >{{ airport.iataCode }} · {{ airport.name }}</button>
      </div>
      <div v-else-if="event.tool === 'search_flights'" class="chat-flight-list">
        <article v-for="(item, index) in flights(event)" :key="item.id" class="chat-flight-card">
          <div><strong>{{ index + 1 }} · {{ item.flightNumber }}</strong><span>{{ item.airline.name }}</span></div>
          <div><strong>{{ formatTime(item.departureAt, item.originAirport.timezone) }} {{ item.originAirport.iataCode }} → {{ formatTime(item.arrivalAt, item.destinationAirport.timezone) }} {{ item.destinationAirport.iataCode }}</strong><span>Nonstop · {{ formatDuration(item.durationMinutes) }}</span></div>
          <div><span>{{ item.availableSeats }} seats left</span><strong>{{ formatMoney(item.price.amount, item.price.currency) }} per traveler</strong></div>
          <button type="button" :disabled="!interactive" @click="emit('quick', `Review ${item.flightNumber} (${item.id}) departing ${item.departureAt} for ${passengers} travelers. Do not book yet.`)">Select</button>
        </article>
      </div>
      <div v-else-if="event.tool === 'get_flight' && flight(event)" class="chat-review-card">
        <strong>{{ flight(event)?.flightNumber }} · {{ flight(event)?.airline.name }}</strong>
        <span>{{ formatFlightDate(flight(event)!.departureAt, flight(event)!.originAirport.timezone) }}</span>
        <span>{{ formatTime(flight(event)!.departureAt, flight(event)!.originAirport.timezone) }} {{ flight(event)?.originAirport.iataCode }} → {{ formatTime(flight(event)!.arrivalAt, flight(event)!.destinationAirport.timezone) }} {{ flight(event)?.destinationAirport.iataCode }}</span>
        <span>{{ passengers }} travelers · Total {{ formatMoney(centsToAmount(amountToCents(flight(event)!.price.amount) * passengers), flight(event)!.price.currency) }}</span>
        <div v-if="!hasBooking && interactive" class="chat-actions">
          <button class="button button--small" type="button" @click="emit('quick', `Confirm booking ${flight(event)?.flightNumber} (${flight(event)?.id}) departing ${flight(event)?.departureAt} for ${passengers} seats at ${flight(event)?.price.amount} USD per traveler.`)">Confirm booking</button>
          <button class="button button--outline button--small" type="button" @click="emit('quick', 'Show other flights for the same search.')">Show other flights</button>
        </div>
      </div>
      <div v-else-if="event.tool === 'create_booking' && booking(event)" class="chat-booking-card">
        <span>Booking confirmed</span><strong>{{ booking(event)?.bookingReference }}</strong>
        <span>{{ formatMoney(booking(event)!.pricing.totalAmount, booking(event)!.pricing.currency) }}</span>
        <RouterLink :to="`/trips/${booking(event)?.id}`">View booking</RouterLink>
      </div>
      <div v-else-if="event.tool === 'list_my_bookings'" class="chat-booking-list">
        <RouterLink v-for="item in bookings(event)" :key="item.id" :to="`/trips/${item.id}`">
          {{ item.bookingReference }} · {{ item.flight.flightNumber }} · {{ item.status.toLowerCase() }}
        </RouterLink>
      </div>
      <div v-else-if="event.tool === 'cancel_booking' && booking(event)" class="chat-booking-card">
        <span>Booking cancelled</span><strong>{{ booking(event)?.bookingReference }}</strong>
        <RouterLink :to="`/trips/${booking(event)?.id}`">View booking</RouterLink>
      </div>
    </template>
  </div>
</template>
