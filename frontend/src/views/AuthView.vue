<script setup lang="ts">
import { ElAlert, ElButton, ElCheckbox, ElForm, ElFormItem, ElInput } from 'element-plus'
import { Eye, EyeOff, LoaderCircle } from 'lucide-vue-next'
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
  <main class="grid min-h-dvh grid-rows-[1fr_auto] gap-12 px-5 py-8 sm:px-8">
    <section class="mx-auto w-full max-w-md self-center py-8">
      <h1 class="text-center text-3xl font-semibold tracking-tight text-slate-900">
        {{ register ? 'Create an account' : 'Welcome back' }}
      </h1>
      <p class="mt-3 mb-8 text-center text-sm text-slate-500">
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
            <template #suffix
              ><ElButton
                link
                :icon="showPassword ? EyeOff : Eye"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
            /></template>
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
          class="w-full"
          :loading="loading"
          :loading-icon="LoaderCircle"
          :disabled="loading"
          >{{ loading ? 'Please wait…' : register ? 'Create account' : 'Sign in' }}</ElButton
        >
      </ElForm>
      <p class="mt-6 text-center text-sm text-slate-500">
        {{ register ? 'Already registered?' : 'New here?' }}
        <RouterLink
          class="ml-1 font-medium text-teal-700 underline underline-offset-4"
          :to="{ path: register ? '/login' : '/register', query: route.query }"
          >{{ register ? 'Sign in' : 'Create an account' }}</RouterLink
        >
      </p>
    </section>
    <footer class="border-t border-slate-200 pt-5 text-center text-xs text-slate-500">
      Simulated flight booking system
    </footer>
  </main>
</template>
