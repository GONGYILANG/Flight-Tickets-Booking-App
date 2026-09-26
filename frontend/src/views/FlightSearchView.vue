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
      <div class="relative isolate h-[350px] overflow-hidden bg-[#eaf3fa] sm:h-[400px]">
        <img
          src="/images/aircraft-hero.jpg"
          alt=""
          width="2172"
          height="724"
          fetchpriority="high"
          class="absolute inset-x-0 bottom-0 h-[210px] w-full object-cover object-right [mask-image:linear-gradient(to_bottom,transparent,black_24%)] sm:inset-0 sm:h-full sm:object-center sm:[mask-image:none]"
        />
        <div
          class="relative mx-auto flex h-full max-w-7xl items-start px-5 pt-8 sm:items-center sm:px-8 sm:pt-0 sm:pb-10"
        >
          <div class="max-w-xl">
            <h1
              class="text-[28px] leading-tight font-semibold tracking-tight text-[#10233f] sm:text-4xl"
            >
              Where would you like to go?
            </h1>
            <p class="mt-4 max-w-sm text-sm leading-6 text-[#334b68] sm:text-base">
              Find your next flight. Keep every trip in one place.
            </p>
          </div>
        </div>
      </div>
      <div class="relative z-10 mx-auto -mt-10 max-w-7xl px-4 pb-12 sm:px-8 sm:pb-20">
        <ElForm
          label-position="top"
          class="grid items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.2)] sm:grid-cols-2 sm:p-6 xl:grid-cols-[1.2fr_auto_1.2fr_1fr_.85fr_auto]"
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
        <div class="my-8 text-center">
          <RouterLink
            class="inline-flex items-center gap-2 font-medium text-blue-700 hover:underline"
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
            class="h-auto! w-full justify-between! rounded-xl! border! border-slate-200! bg-white! px-5! py-5! shadow-sm transition-shadow hover:shadow-md [&>span]:w-full [&>span]:justify-between"
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
