<script setup lang="ts">
import { ElAlert, ElButton, ElDescriptions, ElDescriptionsItem, ElTag } from 'element-plus'
import { LoaderCircle, LogOut } from 'lucide-vue-next'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const signingOut = ref(false)
const error = ref('')

async function signOut() {
  if (signingOut.value) return
  signingOut.value = true
  error.value = ''
  try {
    await auth.signOut()
    await router.replace('/login')
  } catch (reason) {
    error.value = `Sign out could not be completed. ${(reason as Error).message}`
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <AppShell>
    <section>
      <h1 class="text-2xl font-semibold tracking-tight">Profile</h1>
      <p class="mt-2 text-sm text-slate-500">Your account details</p>
      <div
        class="mx-auto mt-10 max-w-3xl rounded-xl border border-slate-200 p-5 sm:p-7 bg-white shadow-sm shadow-slate-900/5"
      >
        <h2 class="mb-6 text-lg font-semibold">Account details</h2>
        <ElDescriptions :column="1" direction="vertical" border>
          <ElDescriptionsItem label="Display name">{{ auth.user?.displayName }}</ElDescriptionsItem>
          <ElDescriptionsItem label="Email">
            <span class="break-all">{{ auth.user?.email }}</span>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Account status">
            <ElTag size="small" :type="auth.user?.status === 'ACTIVE' ? 'success' : 'danger'">
              {{ auth.user?.status === 'ACTIVE' ? 'Active' : auth.user?.status }}
            </ElTag>
          </ElDescriptionsItem>
        </ElDescriptions>
        <div class="mt-6 flex flex-wrap items-center gap-5">
          <RouterLink class="font-medium text-blue-700 hover:underline" to="/trips">
            View my trips
          </RouterLink>
          <ElButton
            type="danger"
            plain
            :icon="LogOut"
            :loading="signingOut"
            :loading-icon="LoaderCircle"
            :disabled="signingOut"
            @click="signOut"
            >{{ signingOut ? 'Signing out…' : 'Sign out' }}
          </ElButton>
        </div>
        <p class="mt-4 text-xs text-slate-500">
          Signing out ends this session. Other devices stay signed in.
        </p>
        <ElAlert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          class="mt-4"
          role="alert"
        />
      </div>
    </section>
  </AppShell>
</template>
