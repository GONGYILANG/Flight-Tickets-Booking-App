<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { CircleUserRound, MessageCircle, Plane, Tickets } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'

defineProps<{ wide?: boolean; flush?: boolean }>()
const auth = useAuthStore()
const route = useRoute()
const links = [
  { to: '/flights', label: 'Flights', icon: Plane },
  { to: '/ai', label: 'AI Assistant', icon: MessageCircle },
  { to: '/trips', label: 'My trips', icon: Tickets },
  { to: '/profile', label: 'Profile', icon: CircleUserRound },
]
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="bg-slate-950 text-white">
      <div class="mx-auto flex h-16 max-w-screen-2xl items-stretch gap-3 px-4 sm:px-8">
        <nav class="flex min-w-0 gap-1 overflow-x-auto" aria-label="Main navigation">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-teal-300"
            :class="
              route.path.startsWith(link.to)
                ? 'border-teal-400 text-teal-200'
                : 'border-transparent text-slate-200'
            "
            :aria-current="route.path.startsWith(link.to) ? 'page' : undefined"
          >
            <component :is="link.icon" :size="18" aria-hidden="true" />{{ link.label }}
          </RouterLink>
        </nav>
        <RouterLink
          class="ml-auto flex shrink-0 items-center gap-2 text-sm hover:text-teal-200"
          to="/profile"
          :aria-label="`Open ${auth.user?.displayName ?? 'profile'}`"
        >
          <CircleUserRound :size="26" aria-hidden="true" />
          <span class="hidden max-w-40 truncate sm:block">{{ auth.user?.displayName }}</span>
        </RouterLink>
      </div>
    </header>
    <main
      class="mx-auto w-full min-w-0 flex-1"
      :class="flush ? 'p-0' : wide ? 'px-4 py-8 lg:px-10' : 'max-w-7xl px-4 py-8 sm:px-6 lg:px-8'"
    >
      <slot />
    </main>
  </div>
</template>
