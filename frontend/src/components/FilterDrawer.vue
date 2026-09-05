<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Airport, DeparturePeriod } from '../types'

export interface FilterValue {
  airlineCode: string
  departurePeriod: '' | DeparturePeriod
  origin: string
  destination: string
}

const props = defineProps<{
  open: boolean
  value: FilterValue
  airlines: Array<{ code: string; name: string }>
  originAirports: Airport[]
  destinationAirports: Airport[]
}>()
const emit = defineEmits<{ close: []; apply: [FilterValue] }>()
const draft = ref<FilterValue>({ ...props.value })
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = { ...props.value }
      dialog.value?.showModal()
    } else dialog.value?.close()
  },
  { flush: 'post' },
)

function reset() {
  draft.value = {
    airlineCode: '',
    departurePeriod: '',
    origin: props.value.origin,
    destination: props.value.destination,
  }
}
</script>

<template>
  <Teleport to="body">
      <dialog ref="dialog" class="filter-drawer" aria-labelledby="filter-title" @cancel.prevent="emit('close')" @click.self="emit('close')">
        <header><h2 id="filter-title">Filters</h2><button type="button" @click="reset">Reset</button></header>
        <div class="filter-drawer__body">
          <fieldset>
            <legend>Airline</legend>
            <label><input v-model="draft.airlineCode" name="airline" type="radio" value="" /> Any airline</label>
            <label v-for="airline in airlines" :key="airline.code">
              <input v-model="draft.airlineCode" name="airline" type="radio" :value="airline.code" />
              {{ airline.name }} ({{ airline.code }})
            </label>
          </fieldset>
          <fieldset>
            <legend>Departure time</legend>
            <div class="segmented">
              <label><input v-model="draft.departurePeriod" name="period" type="radio" value="" /><span>Any time</span></label>
              <label><input v-model="draft.departurePeriod" name="period" type="radio" value="MORNING" /><span>Morning</span></label>
              <label><input v-model="draft.departurePeriod" name="period" type="radio" value="AFTERNOON" /><span>Afternoon</span></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Origin airport</legend>
            <label v-for="airport in originAirports" :key="airport.id">
              <input v-model="draft.origin" name="origin" type="radio" :value="airport.iataCode" />
              {{ airport.iataCode }} · {{ airport.name.replace(' International Airport', '').replace(' Airport', '') }}
            </label>
          </fieldset>
          <fieldset>
            <legend>Destination airport</legend>
            <label v-for="airport in destinationAirports" :key="airport.id">
              <input v-model="draft.destination" name="destination" type="radio" :value="airport.iataCode" />
              {{ airport.iataCode }} · {{ airport.name.replace(' International Airport', '').replace(' Airport', '') }}
            </label>
          </fieldset>
        </div>
        <footer>
          <button class="button button--outline" type="button" @click="emit('close')">Cancel</button>
          <button class="button" type="button" @click="emit('apply', draft)">Apply</button>
        </footer>
      </dialog>
  </Teleport>
</template>
