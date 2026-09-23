<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { CircleUserRound, MessageCircle, Moon, Plane, Sun, Tickets } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'

defineProps<{ wide?: boolean; flush?: boolean }>()
const auth = useAuthStore()
const theme = useThemeStore()
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
    <header
      class="relative z-30 bg-[#10233f] text-white shadow-sm dark:bg-[#0b1424] dark:text-neutral-100"
    >
      <div class="mx-auto flex h-16 max-w-screen-2xl items-stretch gap-3 px-4 sm:px-8">
        <nav class="flex min-w-0 gap-1 overflow-x-auto" aria-label="Main navigation">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-blue-300"
            :class="
              route.path.startsWith(link.to)
                ? 'border-blue-400 bg-white/5 text-blue-100'
                : 'border-transparent text-slate-200 dark:text-neutral-400'
            "
            :aria-current="route.path.startsWith(link.to) ? 'page' : undefined"
          >
            <component :is="link.icon" :size="18" aria-hidden="true" />{{ link.label }}
          </RouterLink>
        </nav>
        <button
          type="button"
          class="ml-auto flex shrink-0 items-center px-2 text-sm hover:text-blue-200"
          :aria-label="theme.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="theme.toggle()"
        >
          <Sun v-if="theme.theme === 'dark'" :size="20" aria-hidden="true" />
          <Moon v-else :size="20" aria-hidden="true" />
        </button>
        <RouterLink
          class="flex shrink-0 items-center gap-2 text-sm hover:text-blue-200"
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
