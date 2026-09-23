<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElButton, ElOption, ElSelect } from 'element-plus'
import { ChevronDown, MapPin } from 'lucide-vue-next'
import { searchAirports } from '../api'
import type { Airport } from '../types'

const props = defineProps<{ label: string; modelValue: Airport | null; exclude?: string }>()
const emit = defineEmits<{ 'update:modelValue': [Airport] }>()
const results = ref<Airport[]>([])
const loading = ref(false)
const error = ref('')
let controller: AbortController | null = null
const popular = ['Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Tokyo', 'Singapore']

async function search(value: string) {
  controller?.abort()
  const request = new AbortController()
  controller = request
  results.value = []
  error.value = ''
  loading.value = Boolean(value.trim())
  if (!value.trim()) return
  try {
    const matches = await searchAirports(value.trim(), 20, request.signal)
    if (!request.signal.aborted)
      results.value = matches.filter((airport) => airport.iataCode !== props.exclude)
  } catch {
    if (!request.signal.aborted) error.value = 'Airports could not be loaded. Try searching again.'
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}

function choose(code: string) {
  const airport = results.value.find((item) => item.iataCode === code)
  if (airport) emit('update:modelValue', airport)
}

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <ElSelect
    :model-value="modelValue?.iataCode"
    :aria-label="label"
    :placeholder="`Select ${label.toLowerCase()}`"
    filterable
    remote
    :remote-method="search"
    :debounce="250"
    :loading="loading"
    :suffix-icon="ChevronDown"
    :no-data-text="error || 'Search by city, airport, or IATA code'"
    class="w-full"
    :fit-input-width="false"
    popper-class="max-w-[calc(100vw-2rem)]"
    @change="choose"
    @visible-change="(visible) => visible && search(modelValue?.cityName ?? '')"
  >
    <template #prefix><MapPin :size="16" aria-hidden="true" /></template>
    <template #label>{{ modelValue?.cityName }} ({{ modelValue?.iataCode }})</template>
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
