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
      '/api': 'http://localhost:3000',
    },
  },
})
