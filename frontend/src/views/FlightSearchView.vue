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
  History,
  MessageCircle,
  Search,
  Sparkles,
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
  if (search.origin.cityName === search.destination.cityName) {
    error.value = 'Origin and destination cities must be different.'
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
  <AppShell flush>
    <section>
      <div class="relative isolate overflow-hidden bg-brand-gradient">
        <img
          src="/images/aircraft-hero.jpg"
          alt=""
          width="2172"
          height="724"
          fetchpriority="high"
          class="absolute inset-0 h-full w-full object-cover object-center opacity-25
           mix-blend-luminosity [mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
        />
        <div
          class="absolute -top-24 right-0 size-96 rounded-full bg-sky-300/25 blur-3xl"
          aria-hidden="true"
        ></div>
        <div
          class="absolute bottom-0 left-1/4 size-72 rounded-full bg-indigo-400/20 blur-3xl"
          aria-hidden="true"
        ></div>
        <div class="relative mx-auto max-w-7xl px-5 pt-8 pb-20 sm:px-8 sm:pt-16 sm:pb-28">
          <div class="max-w-2xl animate-fade-up">
            <span
              class="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5
               text-xs font-semibold tracking-wider text-sky-100 uppercase backdrop-blur-sm"
            >
              <Sparkles :size="14" aria-hidden="true" />AI-powered flight booking
            </span>
            <h1
              class="mt-5 font-display text-[32px] font-extrabold leading-tight tracking-tight
               text-white sm:text-[44px]"
            >
              Where would you like to go?
            </h1>
            <p class="mt-4 max-w-md text-sm leading-6 text-blue-100 sm:text-base">
              Search real-time flights, book in seconds, and keep every trip in one place.
            </p>
          </div>
        </div>
      </div>
      <div class="relative z-10 mx-auto -mt-14 max-w-7xl px-4 pb-12 sm:px-8 sm:pb-20">
        <ElForm
          label-position="top"
          class="grid animate-fade-up [animation-delay:120ms] items-end gap-4 rounded-2xl
           border border-slate-200 bg-surface p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]
           ring-1 ring-slate-900/5 sm:grid-cols-2 sm:p-7 xl:grid-cols-[1.2fr_auto_1.2fr_1fr_.85fr_auto]"
          @submit.prevent="openResults()"
        >
          <ElFormItem label="From" class="mb-0! min-w-0">
            <AirportPicker v-model="origin" label="From" />
          </ElFormItem>
          <ElButton
            :icon="ArrowLeftRight"
            aria-label="Swap origin and destination"
            class="w-full rounded-lg! xl:w-10"
            @click="swap"
          />
          <ElFormItem label="To" class="mb-0! min-w-0">
            <AirportPicker v-model="destination" label="To" />
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
        <RouterLink
          to="/ai"
          class="group mt-8 flex animate-fade-up [animation-delay:180ms] items-center
           justify-between gap-4 rounded-2xl border border-blue-700/15 bg-blue-700/5
           px-6 py-5 transition-all hover:border-blue-700/30 hover:bg-blue-700/10"
        >
          <span class="flex items-center gap-4">
            <span
              class="flex size-11 shrink-0 items-center justify-center rounded-xl
               bg-brand-gradient text-white shadow-md shadow-blue-900/20"
            >
              <MessageCircle :size="20" aria-hidden="true" />
            </span>
            <span>
              <strong class="block font-display text-sm font-bold text-slate-900">
                Not sure where to start?
              </strong>
              <span class="text-sm text-slate-500">
                Ask the AI Assistant to plan and book your trip.
              </span>
            </span>
          </span>
          <ArrowRight
            :size="18"
            class="shrink-0 text-blue-700 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </RouterLink>
        <section v-if="recent" class="mt-8 animate-fade-up [animation-delay:240ms]">
          <h2 class="mb-4 flex items-center gap-2 font-display text-lg font-bold">
            <History :size="18" class="text-slate-400" aria-hidden="true" />Recent search
          </h2>
          <ElButton
            text
            class="h-auto! w-full justify-between! rounded-2xl! border! border-slate-200!
             bg-surface! px-6! py-5! shadow-sm transition-shadow hover:shadow-md
             [&>span]:w-full [&>span]:justify-between"
            @click="openResults(recent)"
          >
            <span class="flex flex-wrap items-center gap-2 text-sm">
              {{ recent.origin.iataCode }}<ArrowRight :size="16" aria-hidden="true" />
              {{ recent.destination.iataCode }}
              · {{ formatShortDate(recent.departureDate).replace(/^\w+, /, '') }} ·
              {{ recent.passengers }} travelers
            </span>
            <ChevronRight :size="18" aria-hidden="true" />
          </ElButton>
        </section>
      </div>
    </section>
  </AppShell>
</template>
