import { defineConfig } from 'vite'
import { authPlugin } from './server/auth.js'
import { gastosApiPlugin } from './server/gastos-api.js'

export default defineConfig({
  plugins: [authPlugin(), gastosApiPlugin()],
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
