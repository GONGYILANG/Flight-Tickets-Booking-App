<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDrawer, ElForm, ElFormItem, ElRadio, ElRadioGroup } from 'element-plus'
import { RotateCcw, X } from 'lucide-vue-next'
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
watch(
  () => props.open,
  (open) => {
    if (open) draft.value = { ...props.value }
  },
)
function reset() {
  draft.value = { ...props.value, airlineCode: '', departurePeriod: '' }
}
</script>

<template>
  <ElDrawer
    :model-value="open"
    title="Filters"
    size="min(440px, 100vw)"
    :close-icon="X"
    @update:model-value="emit('close')"
  >
    <ElForm :model="draft" label-position="top" @submit.prevent="emit('apply', { ...draft })">
      <ElFormItem label="Airline">
        <ElRadioGroup
          v-model="draft.airlineCode"
          class="flex! flex-col items-start! gap-1"
          aria-label="Airline"
        >
          <ElRadio value="">Any airline</ElRadio>
          <ElRadio v-for="airline in airlines" :key="airline.code" :value="airline.code"
            >{{ airline.name }} ({{ airline.code }})</ElRadio
          >
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem label="Departure time">
        <ElRadioGroup
          v-model="draft.departurePeriod"
          aria-label="Departure time"
          class="flex flex-wrap gap-1"
        >
          <ElRadio value="">Any time</ElRadio><ElRadio value="MORNING">Morning</ElRadio
          ><ElRadio value="AFTERNOON">Afternoon</ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem label="Origin airport">
        <ElRadioGroup
          v-model="draft.origin"
          class="flex! flex-col items-start!"
          aria-label="Origin airport"
        >
          <ElRadio v-for="airport in originAirports" :key="airport.id" :value="airport.iataCode"
            >{{ airport.iataCode }} · {{ airport.cityName }}</ElRadio
          >
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem label="Destination airport">
        <ElRadioGroup
          v-model="draft.destination"
          class="flex! flex-col items-start!"
          aria-label="Destination airport"
        >
          <ElRadio
            v-for="airport in destinationAirports"
            :key="airport.id"
            :value="airport.iataCode"
            >{{ airport.iataCode }} · {{ airport.cityName }}</ElRadio
          >
        </ElRadioGroup>
      </ElFormItem>
      <ElButton :icon="RotateCcw" text @click="reset">Reset</ElButton>
    </ElForm>
    <template #footer>
      <div class="flex justify-end gap-3">
        <ElButton @click="emit('close')">Cancel</ElButton>
        <ElButton type="primary" @click="emit('apply', { ...draft })">Apply</ElButton>
      </div>
    </template>
  </ElDrawer>
</template>
