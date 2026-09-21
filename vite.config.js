import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 4731,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4731,
    strictPort: true,
  },
})
