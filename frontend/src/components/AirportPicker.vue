<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { searchAirports } from '../api'
import type { Airport } from '../types'

const props = defineProps<{ label: string; modelValue: Airport | null; exclude?: string }>()
const emit = defineEmits<{ 'update:modelValue': [Airport] }>()
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const query = ref('')
const results = ref<Airport[]>([])
const loading = ref(false)
const error = ref('')

const popular = ['Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Tokyo', 'Singapore']

watch([query, open], (_values, _old, cleanup) => {
  const term = query.value.trim()
  results.value = []
  error.value = ''
  loading.value = Boolean(open.value && term)
  if (!open.value || !term) return
  const controller = new AbortController()
  const timer = window.setTimeout(async () => {
    try {
      const airports = await searchAirports(term, 20, controller.signal)
      if (!controller.signal.aborted) results.value = airports.filter((airport) => airport.iataCode !== props.exclude)
    } catch {
      if (!controller.signal.aborted) error.value = 'Airports could not be loaded.'
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  }, 250)
  cleanup(() => { window.clearTimeout(timer); controller.abort() })
})

async function show() {
  open.value = true
  query.value = props.modelValue?.cityName ?? ''
  await nextTick()
  input.value?.focus()
}

function close() {
  open.value = false
  trigger.value?.focus()
}

function choose(airport: Airport) {
  emit('update:modelValue', airport)
  close()
}

function outside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
})
</script>

<template>
  <div ref="root" class="airport-picker">
    <button ref="trigger" class="search-field" type="button" aria-haspopup="dialog" :aria-expanded="open" @click="show">
      <span>{{ label }}</span>
      <strong>{{ modelValue ? `${modelValue.cityName} (${modelValue.iataCode})` : `Select ${label.toLowerCase()}` }}</strong>
    </button>
    <section v-if="open" class="airport-popover" role="dialog" :aria-label="`Select ${label === 'From' ? 'origin' : 'destination'}`" @keydown.esc.stop="close">
      <h2>Select {{ label === 'From' ? 'origin' : 'destination' }}</h2>
      <input
        ref="input"
        v-model="query"
        type="search"
        placeholder="Search city, airport, or IATA code"
        aria-label="Search airports"
      />
      <p v-if="loading" class="muted">Searching…</p>
      <p v-else-if="error" class="form-error">{{ error }}</p>
      <div v-else-if="results.length" class="airport-results">
        <p class="airport-group">{{ results[0]?.cityName }}</p>
        <button v-for="airport in results" :key="airport.id" type="button" :aria-pressed="airport.id === modelValue?.id" @click="choose(airport)">
          <strong>{{ airport.iataCode }}</strong><span>{{ airport.name }}</span>
          <span v-if="airport.id === modelValue?.id" class="check" aria-label="Selected">✓</span>
        </button>
      </div>
      <p v-else-if="query.trim()" class="muted" role="status">No matching airports.</p>
      <p class="airport-group">Popular cities</p>
      <div class="popular-cities">
        <button v-for="city in popular" :key="city" type="button" @click="query = city">{{ city }}</button>
      </div>
      <button class="popover-close" type="button" @click="close">Close</button>
    </section>
  </div>
</template>
