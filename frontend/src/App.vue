<script setup lang="ts">
import { ElAlert, ElButton, ElConfigProvider } from 'element-plus'
import en from 'element-plus/es/locale/lang/en'
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
  <ElConfigProvider :locale="en" size="large">
    <ElAlert
      v-if="serviceUnavailable"
      type="warning"
      :closable="false"
      class="rounded-none!"
      role="status"
    >
      <template #title>
        <span class="mr-3">The booking service is currently unavailable.</span>
        <ElButton size="small" @click="checkHealth">Retry</ElButton>
      </template>
    </ElAlert>
    <RouterView />
  </ElConfigProvider>
</template>
