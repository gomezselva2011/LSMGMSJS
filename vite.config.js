import { defineConfig } from 'vite'
import { gastosApiPlugin } from './server/gastos-api.js'

export default defineConfig({
  plugins: [gastosApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 4731,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4731,
    strictPort: true,
    allowedHosts: true,
  },
})
