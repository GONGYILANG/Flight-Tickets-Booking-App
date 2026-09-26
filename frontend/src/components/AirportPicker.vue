<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElButton, ElOption, ElSelect } from 'element-plus'
import { ChevronDown, MapPin } from 'lucide-vue-next'
import { searchAirports } from '../api'
import type { Airport } from '../types'

const props = defineProps<{ label: string; modelValue: Airport | null }>()
const emit = defineEmits<{ 'update:modelValue': [Airport] }>()
const results = ref<Airport[]>([])
const loading = ref(false)
const error = ref('')
const query = ref('')
let controller: AbortController | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined
const popular = ['Shanghai', 'Beijing', 'Hong Kong', 'Chengdu', 'Tokyo', 'Singapore']

function search(value: string) {
  // Every new input/shortcut owns the latest search, including during the debounce window.
  clearTimeout(searchTimer)
  controller?.abort()
  const request = new AbortController()
  controller = request
  results.value = []
  error.value = ''
  // An empty input may show the selected city's airports; never replace a typed query on open.
  const term = value.trim() || props.modelValue?.cityName || ''
  query.value = term
  loading.value = Boolean(term)
  if (!term) return
  searchTimer = setTimeout(async () => {
    try {
      const matches = await searchAirports(term, 20, request.signal)
      if (!request.signal.aborted) results.value = matches
    } catch {
      if (!request.signal.aborted)
        error.value = 'Airports could not be loaded. Try searching again.'
    } finally {
      if (!request.signal.aborted) loading.value = false
    }
  }, 250)
}

function choose(code: string) {
  const airport = results.value.find((item) => item.iataCode === code)
  if (airport) emit('update:modelValue', airport)
}

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  controller?.abort()
})
</script>

<template>
  <ElSelect
    :model-value="modelValue?.iataCode"
    :aria-label="label"
    :placeholder="`Select ${label.toLowerCase()}`"
    filterable
    remote
    :remote-method="search"
    :debounce="0"
    :loading="loading"
    :suffix-icon="ChevronDown"
    remote-show-suffix
    class="w-full"
    :fit-input-width="false"
    popper-class="max-w-[calc(100vw-2rem)]"
    @change="choose"
  >
    <template #prefix><MapPin :size="16" aria-hidden="true" /></template>
    <template #label>{{ modelValue?.cityName }} ({{ modelValue?.iataCode }})</template>
    <template #empty>
      <p class="px-4 py-3 text-sm text-slate-500" role="status">
        {{
          loading
            ? 'Loading airports…'
            : error || (query ? 'No matching airports' : 'Search by city, airport, or IATA code')
        }}
      </p>
    </template>
    <template #header>
      <div class="grid max-w-96 grid-cols-2 gap-2 p-1 sm:grid-cols-3">
        <ElButton
          v-for="city in popular"
          :key="city"
          class="m-0!"
          size="small"
          @click.stop="search(city)"
          >{{ city }}</ElButton
        >
      </div>
    </template>
    <ElOption
      v-for="airport in results"
      :key="airport.id"
      :label="`${airport.cityName} (${airport.iataCode})`"
      :value="airport.iataCode"
    >
      <span class="mr-3 font-semibold text-blue-700">{{ airport.iataCode }}</span>
      <span>{{ airport.name }}</span>
    </ElOption>
  </ElSelect>
</template>
