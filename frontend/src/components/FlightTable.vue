<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { ChevronRight } from 'lucide-vue-next'
import { formatDuration, formatMoney, formatTime } from '../lib'
import type { Flight } from '../types'

defineProps<{ flights: Flight[]; passengers: number; selectable?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ select: [Flight] }>()
</script>

<template>
  <ElTable
    :data="flights"
    row-key="id"
    size="default"
    class="w-full"
    aria-label="Flight results"
    empty-text="No flights found"
  >
    <ElTableColumn label="Flight" min-width="185">
      <template #default="{ row }"
        ><div class="py-3">
          <strong class="text-base">{{ row.flightNumber }}</strong>
          <p class="mt-1 text-xs text-slate-500">{{ row.airline.name }}</p>
        </div></template
      >
    </ElTableColumn>
    <ElTableColumn label="Departure" min-width="140">
      <template #default="{ row }"
        ><span class="mr-2 text-lg font-semibold tabular-nums">{{
          formatTime(row.departureAt, row.originAirport.timezone)
        }}</span
        ><span class="text-xs text-slate-500">{{ row.originAirport.iataCode }}</span></template
      >
    </ElTableColumn>
    <ElTableColumn label="Arrival" min-width="140">
      <template #default="{ row }"
        ><span class="mr-2 text-lg font-semibold tabular-nums">{{
          formatTime(row.arrivalAt, row.destinationAirport.timezone)
        }}</span
        ><span class="text-xs text-slate-500">{{ row.destinationAirport.iataCode }}</span></template
      >
    </ElTableColumn>
    <ElTableColumn label="Details" min-width="185">
      <template #default="{ row }">
        <ElTag v-if="row.status === 'DELAYED'" type="warning" size="small">Delayed</ElTag>
        <p v-if="row.scheduleChanged" class="mt-1 text-xs text-slate-500">
          Originally {{ formatTime(row.scheduledDepartureAt, row.originAirport.timezone) }}
        </p>
        <p v-else class="text-xs text-slate-500">
          Nonstop · {{ formatDuration(row.durationMinutes) }}
        </p>
        <p class="mt-1 text-xs text-green-700">{{ row.availableSeats }} seats left</p>
      </template>
    </ElTableColumn>
    <ElTableColumn label="Price" min-width="150">
      <template #default="{ row }"
        ><strong class="text-base text-teal-700 tabular-nums">{{
          formatMoney(row.price.amount, row.price.currency)
        }}</strong></template
      >
    </ElTableColumn>
    <ElTableColumn label="Action" width="135" fixed="right">
      <template #default="{ row }">
        <ElButton
          v-if="selectable"
          type="primary"
          plain
          size="default"
          :disabled="disabled"
          @click="emit('select', row as Flight)"
          >Select</ElButton
        >
        <RouterLink
          v-else
          class="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
          :to="{ path: `/flights/${row.id}`, query: { passengers } }"
          >View flight<ChevronRight :size="16" aria-hidden="true"
        /></RouterLink>
      </template>
    </ElTableColumn>
  </ElTable>
</template>
