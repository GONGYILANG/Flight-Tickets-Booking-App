import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../api'
import type { User } from '../types'
import { useChatStore } from './chat'

const KEY = 'flight-booking-auth'
interface StoredAuth { token: string }

function readStored(): StoredAuth | null {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const value = storage.getItem(KEY)
      const stored = value ? JSON.parse(value) : null
      if (typeof stored?.token === 'string' && stored.token) return stored
    } catch {
      storage.removeItem(KEY)
    }
  }
  return null
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<User | null>(null)
  const isAuthenticated = computed(() => Boolean(token.value && user.value))

  function clear() {
    token.value = null
    user.value = null
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
    api.setAccessToken(null)
    sessionStorage.removeItem('flight-booking-pending-booking')
    useChatStore().clearAll()
  }

  function persist(data: { accessToken: string; user: User }, remember: boolean) {
    clear()
    token.value = data.accessToken
    user.value = data.user
    api.setAccessToken(data.accessToken)
    ;(remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ token: data.accessToken }))
  }

  async function initialize() {
    const stored = readStored()
    if (!stored) return
    token.value = stored.token
    api.setAccessToken(stored.token)
    try {
      user.value = await api.getMe()
    } catch (reason) {
      if (reason instanceof api.ApiError && [401, 403].includes(reason.status)) clear()
    }
  }

  async function signIn(email: string, password: string, remember: boolean) {
    const data = await api.login(email, password)
    persist(data, remember)
  }

  async function signUp(displayName: string, email: string, password: string, remember: boolean) {
    const data = await api.register(displayName, email, password)
    persist(data, remember)
  }

  async function signOut() {
    await api.logout()
    clear()
  }

  return { token, user, isAuthenticated, clear, initialize, signIn, signUp, signOut }
})
