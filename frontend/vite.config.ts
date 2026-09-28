import http from 'node:http'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/chat-api': {
        target: 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/chat-api/, '/api'),
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        // Node's default agent has keepAlive on with no idle timeout, so the proxy holds
        // sockets indefinitely while the backend drops them at its keepAliveTimeout. Closing
        // them here first means the proxy never writes to a socket the backend already
        // released -- which is what surfaced as ECONNRESET on the first request after a gap.
        agent: new http.Agent({ keepAlive: true, timeout: 5_000 }),
      },
    },
  },
})
