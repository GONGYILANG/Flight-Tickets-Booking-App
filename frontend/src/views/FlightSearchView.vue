<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AirportPicker from '../components/AirportPicker.vue'
import AppShell from '../components/AppShell.vue'
import { searchAirports } from '../api'
import { boundedInteger, formatShortDate, isCalendarDate, toSearchParams, today } from '../lib'
import type { Airport } from '../types'

interface RecentSearch {
  origin: Airport
  destination: Airport
  departureDate: string
  passengers: number
}

const KEY = 'flight-booking-recent-search'
const router = useRouter()
const route = useRoute()
const origin = ref<Airport | null>(null)
const destination = ref<Airport | null>(null)
const departureDate = ref(today())
const passengers = ref(1)
const recent = ref<RecentSearch | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as RecentSearch | null
    if (saved?.origin?.iataCode && saved.destination?.iataCode && isCalendarDate(saved.departureDate)) {
      recent.value = saved
      origin.value = saved.origin
      destination.value = saved.destination
      departureDate.value = saved.departureDate < today() ? today() : saved.departureDate
      passengers.value = boundedInteger(saved.passengers, 1, 9)
    }
  } catch {
    localStorage.removeItem(KEY)
  }
  if (typeof route.query.departureDate === 'string' && isCalendarDate(route.query.departureDate)) departureDate.value = route.query.departureDate
  if (route.query.passengers) passengers.value = boundedInteger(route.query.passengers, 1, 9)
  try {
    await Promise.all(([['origin', origin], ['destination', destination]] as const).map(async ([key, selected]) => {
      const code = route.query[key]
      if (typeof code !== 'string') return
      const matches = await searchAirports(code)
      selected.value = matches.find((airport) => airport.iataCode === code.toUpperCase()) ?? null
    }))
  } catch {
    error.value = 'Your previous airports could not be loaded. Please select them again.'
  }
})

function swap() {
  ;[origin.value, destination.value] = [destination.value, origin.value]
}

function openResults(value?: RecentSearch) {
  const search = value ?? {
    origin: origin.value,
    destination: destination.value,
    departureDate: departureDate.value,
    passengers: passengers.value,
  }
  if (!search.origin || !search.destination) {
    error.value = 'Select both an origin and a destination airport.'
    return
  }
  if (search.origin.iataCode === search.destination.iataCode) {
    error.value = 'Origin and destination must be different.'
    return
  }
  if (!isCalendarDate(search.departureDate) || search.departureDate < today()) {
    error.value = 'Choose today or a later departure date.'
    return
  }
  const saved = search as RecentSearch
  localStorage.setItem(KEY, JSON.stringify(saved))
  recent.value = saved
  error.value = ''
  const params = toSearchParams({
    origin: saved.origin.iataCode,
    destination: saved.destination.iataCode,
    departureDate: saved.departureDate,
    passengers: saved.passengers,
    sortBy: 'price',
  })
  void router.push({ path: '/flights/results', query: Object.fromEntries(params) })
}
</script>

<template>
  <AppShell>
    <section class="search-page">
      <h1>Where would you like to go?</h1>
      <form class="flight-search" @submit.prevent="openResults()">
        <AirportPicker v-model="origin" label="From" :exclude="destination?.iataCode" />
        <AirportPicker v-model="destination" label="To" :exclude="origin?.iataCode" />
        <button class="swap-button" type="button" aria-label="Swap origin and destination" @click="swap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12m0 0-3-3m3 3-3 3M17 17H5m0 0 3 3m-3-3 3-3" /></svg>
        </button>
        <label class="search-field"><span>Departure</span><input v-model="departureDate" type="date" :min="today()" required /></label>
        <label class="search-field"><span>Travelers</span><select v-model.number="passengers"><option v-for="count in 9" :key="count" :value="count">{{ count }} traveler{{ count === 1 ? '' : 's' }}</option></select></label>
        <button class="button search-submit" type="submit">Search flights</button>
      </form>
      <p v-if="error" class="form-error search-error" role="alert">{{ error }}</p>
      <RouterLink class="ai-shortcut" to="/ai">Or ask the AI Assistant</RouterLink>
      <section v-if="recent" class="recent-search">
        <h2>Recent search</h2>
        <button type="button" @click="openResults(recent)">
          {{ recent.origin.iataCode }} → {{ recent.destination.iataCode }} · {{ formatShortDate(recent.departureDate).replace(/^\w+, /, '') }} · {{ recent.passengers }} traveler{{ recent.passengers === 1 ? '' : 's' }}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </section>
    </section>
  </AppShell>
</template>
