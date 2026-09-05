import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', component: () => import('../views/AuthView.vue') },
    { path: '/register', component: () => import('../views/AuthView.vue'), props: { register: true } },
    { path: '/flights', component: () => import('../views/FlightSearchView.vue'), meta: { requiresAuth: true } },
    { path: '/flights/results', component: () => import('../views/FlightResultsView.vue'), meta: { requiresAuth: true } },
    { path: '/flights/:flightId', component: () => import('../views/FlightDetailsView.vue'), meta: { requiresAuth: true } },
    { path: '/trips', component: () => import('../views/TripsView.vue'), meta: { requiresAuth: true } },
    { path: '/trips/:bookingId', component: () => import('../views/BookingDetailsView.vue'), meta: { requiresAuth: true } },
    { path: '/profile', component: () => import('../views/ProfileView.vue'), meta: { requiresAuth: true } },
    { path: '/ai', component: () => import('../views/AiAssistantView.vue'), meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
