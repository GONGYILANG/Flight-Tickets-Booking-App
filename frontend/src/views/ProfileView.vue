<script setup lang="ts">
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
    <section class="profile-page">
      <h1>Profile</h1>
      <p class="page-subtitle">Your account details</p>
      <div class="profile-details">
        <h2>Account details</h2>
        <dl>
          <div><dt>Display name</dt><dd>{{ auth.user?.displayName }}</dd></div>
          <div><dt>Email</dt><dd>{{ auth.user?.email }}</dd></div>
          <div><dt>Account status</dt><dd>{{ auth.user?.status === 'ACTIVE' ? 'Active' : auth.user?.status }}</dd></div>
        </dl>
        <RouterLink class="button button--outline" to="/trips">View my trips</RouterLink>
        <button class="danger-link" type="button" :disabled="signingOut" @click="signOut">{{ signingOut ? 'Signing out…' : 'Sign out' }}</button>
        <p class="muted signout-note">Signing out ends this session. Other devices stay signed in.</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>
    </section>
  </AppShell>
</template>
