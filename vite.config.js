import { defineConfig } from 'vite'
import { authPlugin } from './server/auth.js'
import { gastosApiPlugin } from './server/gastos-api.js'

// URL pública: data/public-url.txt. Si el túnel tmux gastos-public-tunnel
// ya corre, reúsala (`npm run public-url`). NUNCA `cloudflared tunnel --url`
// otra vez: cada restart inventa un hostname trycloudflare nuevo.

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
