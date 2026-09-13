<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElOption,
  ElSelect,
} from 'element-plus'
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Search,
} from 'lucide-vue-next'
import { h, onMounted, ref } from 'vue'
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
// DatePicker expects an object component; Lucide exports a functional component.
const calendarIcon = { render: () => h(CalendarDays, { size: 16 }) }

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as RecentSearch | null
    if (
      saved?.origin?.iataCode &&
      saved.destination?.iataCode &&
      isCalendarDate(saved.departureDate)
    ) {
      recent.value = saved
      origin.value = saved.origin
      destination.value = saved.destination
      departureDate.value = saved.departureDate < today() ? today() : saved.departureDate
      passengers.value = boundedInteger(saved.passengers, 1, 9)
    }
  } catch {
    localStorage.removeItem(KEY)
  }
  if (typeof route.query.departureDate === 'string' && isCalendarDate(route.query.departureDate))
    departureDate.value = route.query.departureDate
  if (route.query.passengers) passengers.value = boundedInteger(route.query.passengers, 1, 9)
  try {
    await Promise.all(
      (
        [
          ['origin', origin],
          ['destination', destination],
        ] as const
      ).map(async ([key, selected]) => {
        const code = route.query[key]
        if (typeof code !== 'string') return
        const matches = await searchAirports(code)
        selected.value = matches.find((airport) => airport.iataCode === code.toUpperCase()) ?? null
      }),
    )
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
    <section class="py-4 sm:py-8">
      <h1 class="mb-7 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        Where would you like to go?
      </h1>
      <ElForm
        label-position="top"
        class="grid items-end gap-4 rounded-xl border border-slate-200 p-5 sm:grid-cols-2 xl:grid-cols-[1.2fr_auto_1.2fr_1fr_.85fr_auto]"
        @submit.prevent="openResults()"
      >
        <ElFormItem label="From" class="mb-0! min-w-0">
          <AirportPicker v-model="origin" label="From" :exclude="destination?.iataCode"/>
        </ElFormItem>
        <ElButton
          :icon="ArrowLeftRight"
          aria-label="Swap origin and destination"
          class="w-full xl:w-10"
          @click="swap"
        />
        <ElFormItem label="To" class="mb-0! min-w-0">
          <AirportPicker v-model="destination" label="To" :exclude="origin?.iataCode"/>
        </ElFormItem>
        <ElFormItem label="Departure" for="departure-date" class="mb-0! min-w-0">
          <ElDatePicker
            id="departure-date"
            v-model="departureDate"
            type="date"
            value-format="YYYY-MM-DD"
            format="ddd, MMM D"
            :clearable="false"
            :prefix-icon="calendarIcon"
            :disabled-date="(date: Date) => date < new Date(`${today()}T00:00:00`)"
            placeholder="Select date"
            class="w-full!"
          />
        </ElFormItem>
        <ElFormItem label="Travelers" class="mb-0! min-w-0">
          <ElSelect v-model="passengers" aria-label="Travelers" :suffix-icon="ChevronDown">
            <ElOption
              v-for="count in 9"
              :key="count"
              :value="count"
              :label="`${count} traveler${count === 1 ? '' : 's'}`"
            />
          </ElSelect>
        </ElFormItem>
        <ElButton type="primary" native-type="submit" :icon="Search">Search flights</ElButton>
      </ElForm>
      <ElAlert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        class="mt-4"
        role="alert"
      />
      <div class="my-8 text-center">
        <RouterLink
          class="inline-flex items-center gap-2 font-medium text-teal-700 hover:underline"
          to="/ai"
        >
          <MessageCircle :size="18" aria-hidden="true" />
          Or ask the AI Assistant
        </RouterLink>
      </div>
      <section v-if="recent" class="mt-10">
        <h2 class="mb-4 text-lg font-semibold">Recent search</h2>
        <ElButton
          text
          class="h-auto! w-full justify-between! border-y! border-slate-200! py-5!"
          @click="openResults(recent)"
        >
          <span class="flex flex-wrap items-center gap-2 text-sm">
            {{ recent.origin.iataCode }}<ArrowRight :size="16" aria-hidden="true" />
            {{recent.destination.iataCode}}
            · {{ formatShortDate(recent.departureDate).replace(/^\w+, /, '') }}
            · {{ recent.passengers }} travelers
          </span>
          <ChevronRight :size="18" aria-hidden="true" />
        </ElButton>
      </section>
    </section>
  </AppShell>
</template>
