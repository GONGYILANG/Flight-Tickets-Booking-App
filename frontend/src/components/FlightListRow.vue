<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { formatDuration, formatMoney, formatTime } from '../lib'
import type { Flight } from '../types'

defineProps<{ flight: Flight; passengers: number }>()
</script>

<template>
  <article class="flight-row" :class="{ 'flight-row--delayed': flight.status === 'DELAYED' }">
    <div class="flight-row__airline">
      <strong>{{ flight.flightNumber }}</strong>
      <span>{{ flight.airline.name }}</span>
    </div>
    <div class="flight-row__time">
      <strong>{{ formatTime(flight.departureAt, flight.originAirport.timezone) }}</strong>
      <span>{{ flight.originAirport.iataCode }}</span>
    </div>
    <div class="flight-row__line" aria-hidden="true"><span></span></div>
    <div class="flight-row__time">
      <strong>{{ formatTime(flight.arrivalAt, flight.destinationAirport.timezone) }}</strong>
      <span>{{ flight.destinationAirport.iataCode }}</span>
    </div>
    <div class="flight-row__details">
      <strong v-if="flight.status === 'DELAYED'" class="status-delayed">Delayed</strong>
      <span v-if="flight.scheduleChanged">
        Originally {{ formatTime(flight.scheduledDepartureAt, flight.originAirport.timezone) }}
      </span>
      <span v-else>Nonstop · {{ formatDuration(flight.durationMinutes) }}</span>
      <span class="seats">{{ flight.availableSeats }} seats left</span>
    </div>
    <strong class="flight-row__price">{{ formatMoney(flight.price.amount, flight.price.currency) }}</strong>
    <RouterLink
      class="button button--outline button--small"
      :to="{ path: `/flights/${flight.id}`, query: { passengers } }"
    >View flight</RouterLink>
  </article>
</template>
