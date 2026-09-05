<script setup lang="ts">
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

watch(() => props.register, () => { password.value = ''; error.value = '' })

async function submit() {
  if (loading.value) return
  error.value = ''
  if (props.register && (displayName.value.trim().length < 2 || displayName.value.trim().length > 120)) {
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
    if (props.register) await auth.signUp(displayName.value, email.value, password.value, remember.value)
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
  <main class="auth-page">
    <form class="auth-form" @submit.prevent="submit">
      <h1>{{ register ? 'Create an account' : 'Welcome back' }}</h1>
      <p>{{ register ? 'Register' : 'Sign in' }} to search and manage your trips</p>
      <label v-if="register">Display name<input v-model.trim="displayName" autocomplete="name" placeholder="Your name" minlength="2" maxlength="120" required /></label>
      <label>Email<input v-model.trim="email" type="email" autocomplete="email" placeholder="you@example.com" required autofocus /></label>
      <label>Password
        <span class="password-field"><input v-model="password" :type="showPassword ? 'text' : 'password'" :autocomplete="register ? 'new-password' : 'current-password'" placeholder="Enter your password" required /><button type="button" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="showPassword" d="m3 3 18 18" /></svg></button></span>
      </label>
      <label class="checkbox"><input v-model="remember" type="checkbox" /> Remember me</label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--wide" type="submit" :disabled="loading">{{ loading ? 'Please wait…' : register ? 'Create account' : 'Sign in' }}</button>
      <p class="auth-switch">{{ register ? 'Already registered?' : 'New here?' }} <RouterLink :to="{ path: register ? '/login' : '/register', query: route.query }">{{ register ? 'Sign in' : 'Create an account' }}</RouterLink></p>
    </form>
    <footer>Simulated flight booking system</footer>
  </main>
</template>
