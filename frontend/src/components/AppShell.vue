<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <nav class="topbar__inner" aria-label="Main navigation">
        <div class="topbar__links">
          <RouterLink to="/flights" :class="{ 'router-link-active': route.path.startsWith('/flights') }">Flights</RouterLink>
          <RouterLink to="/ai">AI Assistant</RouterLink>
          <RouterLink to="/trips" :class="{ 'router-link-active': route.path.startsWith('/trips') }">My trips</RouterLink>
          <RouterLink to="/profile">Profile</RouterLink>
        </div>
        <RouterLink class="topbar__user" to="/profile" :aria-label="`Open ${auth.user?.displayName ?? 'profile'}`">
          <span class="user-icon" aria-hidden="true"></span>
          {{ auth.user?.displayName }}
        </RouterLink>
      </nav>
    </header>
    <main class="page"><slot /></main>
  </div>
</template>
