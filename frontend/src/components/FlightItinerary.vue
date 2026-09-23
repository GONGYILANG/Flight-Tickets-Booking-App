<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { formatDuration, formatFlightDate, formatTime } from '../lib'
import type { Flight } from '../types'
defineProps<{ flight: Flight }>()
</script>

<template>
  <div
    class="grid items-center gap-6 rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 p-6 text-center sm:grid-cols-[1fr_auto_1fr]"
  >
    <div class="space-y-2">
      <p class="text-3xl font-semibold tabular-nums">
        {{ formatTime(flight.departureAt, flight.originAirport.timezone) }}
      </p>
      <p class="text-lg font-semibold">{{ flight.originAirport.iataCode }}</p>
      <p class="text-sm text-slate-500">{{ flight.originAirport.name }}</p>
      <p class="text-xs text-slate-500">
        {{ formatFlightDate(flight.departureAt, flight.originAirport.timezone) }}
      </p>
    </div>
    <div class="grid justify-items-center gap-3 text-xs text-slate-500">
      <span>{{ formatDuration(flight.durationMinutes) }} · Nonstop</span>
      <ArrowRight :size="28" class="rotate-90 text-blue-600 sm:rotate-0" aria-hidden="true" />
    </div>
    <div class="space-y-2">
      <p class="text-3xl font-semibold tabular-nums">
        {{ formatTime(flight.arrivalAt, flight.destinationAirport.timezone) }}
      </p>
      <p class="text-lg font-semibold">{{ flight.destinationAirport.iataCode }}</p>
      <p class="text-sm text-slate-500">{{ flight.destinationAirport.name }}</p>
      <p class="text-xs text-slate-500">
        {{ formatFlightDate(flight.arrivalAt, flight.destinationAirport.timezone) }}
      </p>
    </div>
  </div>
</template>
