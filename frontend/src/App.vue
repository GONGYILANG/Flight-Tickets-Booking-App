<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import { getHealth } from './api'

const serviceUnavailable = ref(false)

async function checkHealth() {
  try {
    await getHealth()
    serviceUnavailable.value = false
  } catch {
    serviceUnavailable.value = true
  }
}

onMounted(checkHealth)
</script>

<template>
  <div v-if="serviceUnavailable" class="service-banner" role="status">
    The booking service is currently unavailable.
    <button type="button" @click="checkHealth">Retry</button>
  </div>
  <RouterView />
</template>
