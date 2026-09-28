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
      class="relative z-30 bg-gradient-to-r from-[#0b1526] via-[#10233f] to-[#14305a]
       text-white shadow-lg shadow-black/10 dark:from-[#080f1c] dark:via-[#0b1424]
       dark:to-[#0e1c33] dark:text-neutral-100"
    >
      <div
        class="mx-auto flex h-25 max-w-screen-2xl flex-wrap items-center gap-x-3 gap-y-1
         px-4 py-2 sm:h-16 sm:flex-nowrap sm:px-8"
      >
        <RouterLink
          to="/flights"
          class="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2
           focus-visible:outline-blue-300"
          aria-label="Flight booking home"
        >
          <span
            class="flex size-9 items-center justify-center rounded-xl bg-brand-gradient
             shadow-md shadow-blue-950/40"
          >
            <Plane :size="18" aria-hidden="true" />
          </span>
          <span class="hidden font-display text-[17px] font-bold tracking-tight md:block">
            Flight<span class="text-sky-300">Booking</span>
          </span>
        </RouterLink>
        <nav
          class="order-last flex w-full min-w-0 items-center justify-between gap-1
           overflow-x-auto py-1 sm:order-none sm:ml-4 sm:w-auto sm:justify-start"
          aria-label="Main navigation"
        >
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2
             text-xs font-medium whitespace-nowrap transition-colors hover:bg-white/10
             hover:text-white focus-visible:outline-2 focus-visible:outline-blue-300
             sm:gap-2 sm:px-3.5 sm:text-sm"
            :class="
              route.path.startsWith(link.to)
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-neutral-300'
            "
            :aria-current="route.path.startsWith(link.to) ? 'page' : undefined"
          >
            <component :is="link.icon" :size="17" class="hidden sm:block" aria-hidden="true" />
            {{ link.label }}
          </RouterLink>
        </nav>
        <button
          type="button"
          class="ml-auto flex shrink-0 items-center rounded-full p-2 text-sm transition-colors
           hover:bg-white/10 hover:text-blue-200"
          :aria-label="theme.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="theme.toggle()"
        >
          <Sun v-if="theme.theme === 'dark'" :size="20" aria-hidden="true" />
          <Moon v-else :size="20" aria-hidden="true" />
        </button>
        <RouterLink
          class="flex shrink-0 items-center gap-2 rounded-full py-1.5 pr-1.5 pl-2 text-sm
           transition-colors hover:bg-white/10 hover:text-blue-200"
          to="/profile"
          :aria-label="`Open ${auth.user?.displayName ?? 'profile'}`"
        >
          <span class="hidden max-w-40 truncate sm:block">{{ auth.user?.displayName }}</span>
          <CircleUserRound :size="26" aria-hidden="true" />
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
