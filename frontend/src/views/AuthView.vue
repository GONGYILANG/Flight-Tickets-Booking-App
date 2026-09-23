<script setup lang="ts">
import { ElAlert, ElButton, ElCheckbox, ElForm, ElFormItem, ElInput } from 'element-plus'
import { Eye, EyeOff, LoaderCircle, Plane } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const props = defineProps<{ register?: boolean }>()
const route = useRoute()
const router = useRouter()
const email = ref('')
const displayName = ref('')
const password = ref('')
const remember = ref(false)
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

watch(
  () => props.register,
  () => {
    password.value = ''
    error.value = ''
  },
)

async function submit() {
  if (loading.value) return
  error.value = ''
  if (
    props.register &&
    (displayName.value.trim().length < 2 || displayName.value.trim().length > 120)
  ) {
    error.value = 'Display name must be between 2 and 120 characters.'
    return
  }
  const passwordBytes = new TextEncoder().encode(password.value).length
  if (passwordBytes < 8 || passwordBytes > 72) {
    error.value = 'Password must be between 8 and 72 bytes.'
    return
  }
  loading.value = true
  try {
    if (props.register)
      await auth.signUp(displayName.value, email.value, password.value, remember.value)
    else await auth.signIn(email.value, password.value, remember.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/flights'
    await router.replace(redirect)
  } catch (reason) {
    error.value = (reason as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-6 sm:gap-8 sm:px-8 sm:py-10"
  >
    <div
      class="grid w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_-24px_rgba(15,23,42,0.22)] md:min-h-[680px] md:grid-cols-2"
    >
      <aside
        class="relative isolate flex min-h-[180px] flex-col justify-end overflow-hidden p-6 text-[#fff] sm:p-8 md:min-h-full md:justify-between md:p-10"
        aria-label="Flight booking"
      >
        <img
          src="/images/wing-clouds.jpg"
          alt=""
          width="1086"
          height="1448"
          fetchpriority="high"
          class="absolute inset-0 -z-20 h-full w-full object-cover object-center"
        />
        <div
          class="absolute inset-0 -z-10 bg-linear-to-t from-[#081a34]/90 via-transparent to-[#10233f]/15"
          aria-hidden="true"
        ></div>
        <RouterLink
          to="/flights"
          class="inline-flex w-fit items-center gap-3 text-lg font-semibold text-[#fff] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          <Plane :size="26" aria-hidden="true" />Flight booking
        </RouterLink>
        <div class="mt-10 hidden md:block">
          <h2 class="max-w-sm text-2xl leading-snug font-semibold tracking-tight">
            Your next journey starts here.
          </h2>
          <p class="mt-4 max-w-xs text-sm leading-6 text-blue-100">
            Search flights. Plan with AI. Manage your trips.
          </p>
        </div>
      </aside>
      <section
        class="mx-auto w-full max-w-md self-center px-6 py-9 sm:px-10 sm:py-12 md:max-w-none md:px-12 lg:px-16"
      >
        <h1 class="text-[28px] font-semibold tracking-tight text-slate-900">
          {{ register ? 'Create an account' : 'Welcome back' }}
        </h1>
        <p class="mt-3 mb-8 text-sm leading-6 text-slate-500">
          {{ register ? 'Register' : 'Sign in' }} to search and manage your trips
        </p>
        <ElForm label-position="top" @submit.prevent="submit">
          <ElFormItem v-if="register" label="Display name" for="display-name" required>
            <ElInput
              id="display-name"
              v-model="displayName"
              autocomplete="name"
              placeholder="Your name"
              minlength="2"
              maxlength="120"
              required
            />
          </ElFormItem>
          <ElFormItem label="Email" for="email" required>
            <ElInput
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              maxlength="320"
              required
              autofocus
            />
          </ElFormItem>
          <ElFormItem label="Password" for="password" required>
            <ElInput
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="register ? 'new-password' : 'current-password'"
              placeholder="Enter your password"
              required
            >
              <template #suffix>
                <ElButton
                  link
                  :icon="showPassword ? EyeOff : Eye"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                />
              </template>
            </ElInput>
          </ElFormItem>
          <ElCheckbox v-model="remember" class="mb-4">Remember me</ElCheckbox>
          <ElAlert
            v-if="error"
            :title="error"
            type="error"
            :closable="false"
            class="mb-4"
            role="alert"
          />
          <ElButton
            type="primary"
            native-type="submit"
            class="h-11! w-full shadow-sm shadow-blue-600/20"
            :loading="loading"
            :loading-icon="LoaderCircle"
            :disabled="loading"
            >{{ loading ? 'Please wait…' : register ? 'Create account' : 'Sign in' }}</ElButton
          >
        </ElForm>
        <p class="mt-6 text-center text-sm text-slate-500">
          {{ register ? 'Already registered?' : 'New here?' }}
          <RouterLink
            class="ml-1 font-medium text-blue-700 underline underline-offset-4"
            :to="{ path: register ? '/login' : '/register', query: route.query }"
          >
            {{ register ? 'Sign in' : 'Create an account' }}
          </RouterLink>
        </p>
      </section>
    </div>
    <footer class="text-center text-xs text-slate-500">Simulated flight booking system</footer>
  </main>
</template>
