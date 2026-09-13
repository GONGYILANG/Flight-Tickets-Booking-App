<script setup lang="ts">
import { ElAlert, ElButton, ElOption, ElPagination, ElSelect, ElSkeleton } from 'element-plus'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ListFilter } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import FilterDrawer, { type FilterValue } from '../components/FilterDrawer.vue'
import FlightTable from '../components/FlightTable.vue'
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
  <AppShell wide>
    <section>
      <header class="mb-6 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            class="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900"
          >
            <span>{{ originAirport?.cityName ?? search.origin }} ({{ search.origin }})</span
            ><ArrowRight :size="22" aria-hidden="true" /><span
              >{{ destinationAirport?.cityName ?? search.destination }} ({{
                search.destination
              }})</span
            >
          </h1>
          <p class="mt-2 text-sm text-slate-500">
            {{ formatShortDate(search.departureDate) }} · {{ search.passengers }} traveler{{
              search.passengers === 1 ? '' : 's'
            }}
          </p>
        </div>
        <RouterLink
          class="self-start rounded-lg border border-teal-700 px-4 py-2.5 text-sm font-medium text-teal-700 hover:bg-teal-50 sm:self-auto"
          :to="{ path: '/flights', query: route.query }"
          >Modify search</RouterLink
        >
      </header>
      <div
        class="grid auto-cols-[150px] grid-flow-col overflow-x-auto rounded-lg border border-slate-200 sm:grid-cols-5 sm:grid-flow-row"
        aria-label="Departure dates"
      >
        <ElButton
          v-for="date in dates"
          :key="date"
          text
          class="m-0! h-auto! rounded-none! border-r! border-slate-200! px-5! py-4!"
          :type="date === search.departureDate ? 'primary' : 'default'"
          :bg="date === search.departureDate"
          :aria-pressed="date === search.departureDate"
          @click="updateSearch({ departureDate: date, page: 1 })"
        >
          <span class="grid gap-2"
            ><strong>{{ formatShortDate(date) }}</strong
            ><span class="text-xs">{{ datePrices[date] ?? 'Loading…' }}</span></span
          >
        </ElButton>
      </div>
      <div class="my-6 flex flex-wrap items-center justify-between gap-4">
        <strong
          >{{ pagination.totalItems }} flight{{ pagination.totalItems === 1 ? '' : 's' }}</strong
        >
        <div class="flex flex-wrap items-center gap-3">
          <ElButton :icon="ListFilter" @click="drawerOpen = true">Filters</ElButton>
          <ElSelect
            v-model="sortValue"
            aria-label="Sort flights"
            :suffix-icon="ChevronDown"
            class="w-52!"
          >
            <ElOption value="departureAt:asc" label="Departure time" /><ElOption
              value="price:asc"
              label="Price, low to high"
            /><ElOption value="price:desc" label="Price, high to low" />
          </ElSelect>
        </div>
      </div>
      <ElAlert
        v-if="optionsError"
        :title="optionsError"
        type="error"
        :closable="false"
        class="mb-4"
        role="alert"
        ><ElButton link type="primary" @click="reload++">Retry</ElButton>
      </ElAlert>
      <div v-if="loading" class="py-8" role="status">
        <p class="mb-4 text-slate-500">Loading flights…</p>
        <ElSkeleton :rows="4" animated />
      </div>
      <div v-else-if="error" class="grid gap-4 py-8">
        <ElAlert :title="error" type="error" :closable="false" role="alert" />
        <ElButton
          class="justify-self-center"
          @click="reload++"
          >Try again
        </ElButton>
      </div>
      <FlightTable v-else :flights="flights" :passengers="search.passengers" />
      <ElPagination
        v-if="!loading && !error && pagination.totalPages"
        class="mt-6 justify-center"
        background
        layout="prev, pager, next"
        :prev-icon="ChevronLeft"
        :next-icon="ChevronRight"
        :page-size="pagination.limit"
        :total="pagination.totalItems"
        :current-page="pagination.page"
        aria-label="Results pages"
        @update:current-page="(page) => updateSearch({ page })"
      />
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
