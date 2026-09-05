import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/chat-api': {
        target: 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/chat-api/, '/api'),
      },
      '/api': 'http://localhost:3000',
    },
  },
})
