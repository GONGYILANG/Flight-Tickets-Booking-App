<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ElAlert, ElButton, ElPagination } from 'element-plus'
import { searchFlights } from '../api'
import type { Flight, FlightSearchResult } from '../types'
import FlightTable from './FlightTable.vue'

const props = defineProps<{ result: FlightSearchResult; interactive: boolean }>()
const emit = defineEmits<{ quick: [string] }>()
const result = shallowRef(props.result)
const loading = ref(false)
const error = ref('')
let requestedPage = props.result.pagination.page
let controller: AbortController | undefined
const dateRange = computed(() => {
  const search = result.value.search
  return 'departureDate' in search
    ? search.departureDate
    : `${search.departureDateFrom} – ${search.departureDateTo}`
})

watch(() => props.result, (value) => {
  controller?.abort()
  result.value = value
  requestedPage = value.pagination.page
  loading.value = false
  error.value = ''
})
onBeforeUnmount(() => controller?.abort())

async function loadPage(page: number) {
  controller?.abort()
  const request = new AbortController()
  controller = request
  requestedPage = page
  loading.value = true
  error.value = ''
  const search = props.result.search
  try {
    const next = await searchFlights({
      origin: search.origin,
      destination: search.destination,
      ...('departureDate' in search
        ? { departureDate: search.departureDate }
        : { departureDateFrom: search.departureDateFrom, departureDateTo: search.departureDateTo }),
      passengers: search.passengers,
      departurePeriod: search.departurePeriod ?? undefined,
      airlineCode: search.airlineCode ?? undefined,
      sortBy: search.sortBy,
      sortOrder: search.sortOrder,
      page,
      limit: props.result.pagination.limit,
    }, request.signal)
    if (!request.signal.aborted) result.value = next
  } catch (reason) {
    if (!request.signal.aborted) error.value = (reason as Error).message
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}

function select(flight: Flight) {
  emit('quick',
   `Review ${flight.flightNumber} (${flight.id}) departing ${flight.departureAt}
   from ${flight.originAirport.iataCode} to ${flight.destinationAirport.iataCode}
   for ${result.value.search.passengers} travelers. Do not book yet.`)
}
</script>

<template>
  <section class="grid min-w-0 gap-3" aria-label="Chat flight results" :aria-busy="loading">
    <p class="text-sm text-slate-500">
      {{ result.search.origin }} → {{ result.search.destination }} · {{ dateRange }}
      ({{ result.search.departureTimezone }}) · {{ result.search.passengers }} travelers
    </p>
    <p class="text-sm text-slate-500" role="status">
      {{ result.pagination.totalItems }} matching flights
      <span v-if="result.pagination.totalPages">
        · Showing {{ result.flights.length }} on page {{ result.pagination.page }}
        of {{ result.pagination.totalPages }}
      </span>
      <span v-if="loading"> · Loading flights…</span>
    </p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert">
      <ElButton link type="primary" @click="loadPage(requestedPage)">Retry page</ElButton>
    </ElAlert>
    <FlightTable
      :flights="result.flights"
      :passengers="result.search.passengers"
      selectable
      :disabled="!interactive || loading"
      @select="select"
    />
    <ElPagination
      v-if="result.pagination.totalPages > 1"
      class="max-w-full justify-center"
      size="small"
      background
      layout="prev, pager, next"
      :pager-count="5"
      :current-page="result.pagination.page"
      :page-size="result.pagination.limit"
      :total="result.pagination.totalItems"
      :disabled="loading"
      aria-label="Flight result pages"
      @update:current-page="loadPage"
    />
  </section>
</template>
