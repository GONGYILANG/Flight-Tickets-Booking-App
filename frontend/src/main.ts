import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { setUnauthorizedHandler } from './api'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

const auth = useAuthStore(pinia)
setUnauthorizedHandler(() => {
  auth.clear()
  if (router.currentRoute.value.meta.requiresAuth) {
    void router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } })
  }
})
await auth.initialize()

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if ((to.path === '/login' || to.path === '/register') && auth.isAuthenticated) {
    return '/flights'
  }
})

app.use(router)
await router.isReady()
app.mount('#app')
