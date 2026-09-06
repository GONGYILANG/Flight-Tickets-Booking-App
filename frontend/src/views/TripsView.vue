<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElPagination,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { listBookings } from '../api'
import { boundedInteger, formatFlightDate, formatMoney, formatTime } from '../lib'
import type { Booking, Pagination } from '../types'

const route = useRoute()
const router = useRouter()
const bookings = ref<Booking[]>([])
const pagination = ref<Pagination>({ page: 1, limit: 20, totalItems: 0, totalPages: 0 })
const loading = ref(true)
const error = ref('')
const reload = ref(0)

watch(
  [() => route.query.page, reload],
  async (_value, _old, cleanup) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    loading.value = true
    error.value = ''
    try {
      const result = await listBookings(
        boundedInteger(route.query.page, 1, 10000),
        20,
        controller.signal,
      )
      if (controller.signal.aborted) return
      bookings.value = result.bookings
      pagination.value = result.pagination
    } catch (reason) {
      if (!controller.signal.aborted) error.value = (reason as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  },
  { immediate: true },
)

function go(page: number) {
  void router.replace({ query: { page } })
}
</script>

<template>
  <AppShell wide>
    <section>
      <h1 class="text-2xl font-semibold tracking-tight">My trips</h1>
      <p class="mt-2 text-sm text-slate-500">Your simulated bookings</p>
      <div class="my-6 flex justify-between text-sm text-slate-500">
        <span>Newest first</span
        ><span
          >{{ pagination.totalItems }} booking{{ pagination.totalItems === 1 ? '' : 's' }}</span
        >
      </div>
      <div v-if="loading" class="py-8" role="status">
        <p class="mb-4 text-slate-500">Loading bookings…</p>
        <ElSkeleton :rows="4" animated />
      </div>
      <div v-else-if="error" class="grid gap-4">
        <ElAlert :title="error" type="error" :closable="false" role="alert" /><ElButton
          class="justify-self-start"
          @click="reload++"
          >Try again</ElButton
        >
      </div>
      <ElTable
        v-else
        :data="bookings"
        row-key="id"
        size="default"
        class="w-full"
        aria-label="My trips"
      >
        <ElTableColumn prop="bookingReference" label="Booking" min-width="190"
          ><template #default="{ row }"
            ><strong>{{ row.bookingReference }}</strong></template
          ></ElTableColumn
        >
        <ElTableColumn prop="flight.flightNumber" label="Flight" width="100" />
        <ElTableColumn label="Date & route" min-width="250"
          ><template #default="{ row }"
            ><div class="py-3">
              <strong>{{
                formatFlightDate(row.flight.departureAt, row.flight.originAirport.timezone)
              }}</strong>
              <p class="mt-2 flex items-center gap-1 text-xs text-slate-500">
                {{ formatTime(row.flight.departureAt, row.flight.originAirport.timezone) }}
                {{ row.flight.originAirport.iataCode
                }}<ArrowRight :size="14" aria-hidden="true" />{{
                  formatTime(row.flight.arrivalAt, row.flight.destinationAirport.timezone)
                }}
                {{ row.flight.destinationAirport.iataCode }}
              </p>
            </div></template
          ></ElTableColumn
        >
        <ElTableColumn prop="seatCount" label="Travelers" width="100" />
        <ElTableColumn label="Total" min-width="140"
          ><template #default="{ row }">{{
            formatMoney(row.pricing.totalAmount, row.pricing.currency)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="Source" min-width="125"
          ><template #default="{ row }"
            >Booked via {{ row.source === 'AI' ? 'AI' : 'Web' }}</template
          ></ElTableColumn
        >
        <ElTableColumn label="Status" min-width="130"
          ><template #default="{ row }"
            ><ElTag size="small" :type="row.status === 'CONFIRMED' ? 'success' : 'danger'">{{
              row.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'
            }}</ElTag></template
          ></ElTableColumn
        >
        <ElTableColumn label="Action" width="135" fixed="right"
          ><template #default="{ row }"
            ><RouterLink
              class="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
              :to="`/trips/${row.id}`"
              >View details<ChevronRight :size="16" aria-hidden="true" /></RouterLink></template
        ></ElTableColumn>
        <template #empty
          ><div class="grid justify-items-center gap-3 py-10">
            <p>No bookings yet</p>
            <RouterLink class="font-medium text-teal-700 hover:underline" to="/flights"
              >Search flights</RouterLink
            >
          </div></template
        >
      </ElTable>
      <ElPagination
        v-if="!loading && !error && pagination.totalPages"
        class="mt-6 justify-center"
        background
        layout="prev, pager, next"
        :prev-icon="ChevronLeft"
        :next-icon="ChevronRight"
        :page-size="pagination.limit"
        :total="pagination.totalItems"
        :current-page="pagination.page"
        aria-label="Booking pages"
        @update:current-page="go"
      />
    </section>
  </AppShell>
</template>
