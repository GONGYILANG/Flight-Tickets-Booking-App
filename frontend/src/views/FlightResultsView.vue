<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import FilterDrawer, { type FilterValue } from '../components/FilterDrawer.vue'
import FlightListRow from '../components/FlightListRow.vue'
import { listAirlines, searchAirports, searchFlights } from '../api'
import {
  boundedInteger,
  formatMoney,
  formatShortDate,
  isCalendarDate,
  shiftDate,
  toSearchParams,
} from '../lib'
import type { Airport, Flight, FlightSearchParams, Pagination } from '../types'

const route = useRoute()
const router = useRouter()
const flights = ref<Flight[]>([])
const pagination = ref<Pagination>({ page: 1, limit: 20, totalItems: 0, totalPages: 0 })
const loading = ref(true)
const error = ref('')
const drawerOpen = ref(false)
const airlines = ref<Array<{ code: string; name: string }>>([])
const originAirports = ref<Airport[]>([])
const destinationAirports = ref<Airport[]>([])
const originAirport = ref<Airport | null>(null)
const destinationAirport = ref<Airport | null>(null)
const datePrices = ref<Record<string, string>>({})
const optionsError = ref('')
const reload = ref(0)

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const search = computed<FlightSearchParams>(() => ({
  origin: text(route.query.origin).toUpperCase(),
  destination: text(route.query.destination).toUpperCase(),
  departureDate: text(route.query.departureDate),
  passengers: boundedInteger(route.query.passengers, 1, 9),
  departurePeriod: ['MORNING', 'AFTERNOON'].includes(text(route.query.departurePeriod))
    ? (text(route.query.departurePeriod) as 'MORNING' | 'AFTERNOON')
    : undefined,
  airlineCode: text(route.query.airlineCode) || undefined,
  page: boundedInteger(route.query.page, 1, 10000),
  limit: 20,
  sortBy: ['departureAt', 'price'].includes(text(route.query.sortBy))
    ? (text(route.query.sortBy) as 'departureAt' | 'price')
    : 'price',
  sortOrder: text(route.query.sortOrder) === 'desc' ? 'desc' : 'asc',
}))

const validSearch = computed(
  () =>
    /^[A-Z]{3}$/.test(search.value.origin) &&
    /^[A-Z]{3}$/.test(search.value.destination) &&
    search.value.origin !== search.value.destination &&
    isCalendarDate(search.value.departureDate),
)
const dates = computed(() =>
  validSearch.value
    ? [-1, 0, 1, 2, 3].map((offset) => shiftDate(search.value.departureDate, offset))
    : [],
)
const sortValue = computed({
  get: () => `${search.value.sortBy}:${search.value.sortOrder}`,
  set: (value: string) => {
    const [sortBy, sortOrder] = value.split(':') as ['departureAt' | 'price', 'asc' | 'desc']
    updateSearch({ sortBy, sortOrder, page: 1 })
  },
})
const filterValue = computed<FilterValue>(() => ({
  airlineCode: search.value.airlineCode ?? '',
  departurePeriod: search.value.departurePeriod ?? '',
  origin: search.value.origin,
  destination: search.value.destination,
}))

function updateSearch(values: Partial<FlightSearchParams>) {
  const params = toSearchParams({ ...search.value, ...values })
  void router.replace({ query: Object.fromEntries(params) })
}

async function loadAirportGroup(code: string, signal: AbortSignal) {
  const matches = await searchAirports(code, 20, signal)
  const selected = matches.find((airport) => airport.iataCode === code) ?? null
  if (!selected) return { selected, airports: matches }
  const city = await searchAirports(selected.cityName, 20, signal)
  return { selected, airports: city.filter((airport) => airport.cityName === selected.cityName) }
}

watch(
  [() => search.value.origin, () => search.value.destination, reload],
  async (_values, _old, cleanup) => {
    if (!validSearch.value) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    optionsError.value = ''
    try {
      const [availableAirlines, origins, destinations] = await Promise.all([
        listAirlines(controller.signal),
        loadAirportGroup(search.value.origin, controller.signal),
        loadAirportGroup(search.value.destination, controller.signal),
      ])
      if (controller.signal.aborted) return
      airlines.value = availableAirlines
      originAirport.value = origins.selected
      destinationAirport.value = destinations.selected
      originAirports.value = origins.airports
      destinationAirports.value = destinations.airports
    } catch {
      if (!controller.signal.aborted) optionsError.value = 'Filter options could not be loaded.'
    }
  },
  { immediate: true },
)

watch(
  [
    () => search.value.origin,
    () => search.value.destination,
    () => search.value.departureDate,
    () => search.value.passengers,
    () => search.value.airlineCode,
    () => search.value.departurePeriod,
    reload,
  ],
  async (_values, _old, cleanup) => {
    if (!validSearch.value) return
    const controller = new AbortController()
    cleanup(() => controller.abort())
    datePrices.value = {}
    const entries = await Promise.all(
      dates.value.map(async (date) => {
        try {
          const result = await searchFlights(
            {
              ...search.value,
              departureDate: date,
              page: 1,
              limit: 1,
              sortBy: 'price',
              sortOrder: 'asc',
            },
            controller.signal,
          )
          const cheapest = result.flights[0]
          return [
            date,
            cheapest ? formatMoney(cheapest.price.amount, cheapest.price.currency) : 'No flights',
          ] as const
        } catch {
          return [date, '—'] as const
        }
      }),
    )
    if (!controller.signal.aborted) datePrices.value = Object.fromEntries(entries)
  },
  { immediate: true },
)

watch(
  [search, reload],
  async (_values, _old, cleanup) => {
    if (!validSearch.value) {
      error.value = 'Choose different airports and a valid departure date.'
      loading.value = false
      return
    }
    const controller = new AbortController()
    cleanup(() => controller.abort())
    loading.value = true
    error.value = ''
    try {
      const result = await searchFlights(search.value, controller.signal)
      if (controller.signal.aborted) return
      flights.value = result.flights
      pagination.value = result.pagination
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError'))
        error.value = (reason as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

function applyFilters(value: FilterValue) {
  drawerOpen.value = false
  updateSearch({
    origin: value.origin,
    destination: value.destination,
    airlineCode: value.airlineCode || undefined,
    departurePeriod: value.departurePeriod || undefined,
    page: 1,
  })
}
</script>

<template>
  <AppShell>
    <section class="results-page">
      <header class="route-summary">
        <div>
          <h1>
            {{ originAirport?.cityName ?? search.origin }} ({{ search.origin }}) →
            {{ destinationAirport?.cityName ?? search.destination }} ({{ search.destination }})
          </h1>
          <p>
            {{ formatShortDate(search.departureDate) }} · {{ search.passengers }} traveler{{
              search.passengers === 1 ? '' : 's'
            }}
          </p>
        </div>
        <RouterLink class="button button--outline" :to="{ path: '/flights', query: route.query }">
          Modify search
        </RouterLink>
      </header>

      <div class="date-rail" aria-label="Departure dates">
        <button
          v-for="date in dates"
          :key="date"
          type="button"
          :aria-pressed="date === search.departureDate"
          :class="{ selected: date === search.departureDate }"
          @click="updateSearch({ departureDate: date, page: 1 })"
        >
          <strong>{{ formatShortDate(date) }}</strong>
          <span>{{ datePrices[date] ?? 'Loading…' }}</span>
        </button>
      </div>

      <div class="results-toolbar">
        <strong>
          {{ pagination.totalItems }} flight{{ pagination.totalItems === 1 ? '' : 's' }}
        </strong>
        <div>
          <button class="button button--outline" type="button" @click="drawerOpen = true">
            Filters
          </button>
          <label class="sort-control">
            <span class="visually-hidden">Sort flights</span>
            <select v-model="sortValue">
              <option value="departureAt:asc">Departure time</option>
              <option value="price:asc">Price, low to high</option>
              <option value="price:desc">Price, high to low</option>
            </select>
          </label>
        </div>
      </div>

      <p v-if="optionsError" class="form-error" role="alert">
        {{ optionsError }}
        <button class="link-button" type="button" @click="reload++">Retry</button>
      </p>
      <p v-if="loading" class="state-message">Loading flights…</p>
      <div v-else-if="error" class="state-message state-message--error">
        <p>{{ error }}</p>
        <button class="button button--outline" type="button" @click="reload++">Try again</button>
      </div>
      <div v-else-if="!flights.length" class="state-message">
        <h2>No flights found</h2>
        <p>Try another date or change your filters.</p>
      </div>
      <section v-else class="flight-list" aria-label="Flight results">
        <div class="flight-list__head">
          <span>Flight</span><span>Departure</span><span>Arrival</span><span>Details</span
          ><span>Price</span><span></span>
        </div>
        <FlightListRow
          v-for="flight in flights"
          :key="flight.id"
          :flight="flight"
          :passengers="search.passengers"
        />
      </section>

      <nav
        v-if="!loading && !error && pagination.totalPages"
        class="pagination"
        aria-label="Results pages"
      >
        <button
          type="button"
          :disabled="pagination.page <= 1"
          @click="updateSearch({ page: pagination.page - 1 })"
        >
          Previous
        </button>
        <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button
          type="button"
          :disabled="pagination.page >= pagination.totalPages"
          @click="updateSearch({ page: pagination.page + 1 })"
        >
          Next
        </button>
      </nav>
    </section>
    <FilterDrawer
      :open="drawerOpen"
      :value="filterValue"
      :airlines="airlines"
      :origin-airports="originAirports"
      :destination-airports="destinationAirports"
      @close="drawerOpen = false"
      @apply="applyFilters"
    />
  </AppShell>
</template>
