import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { authPlugin } from './server/auth.js'
import { gastosApiPlugin } from './server/gastos-api.js'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// URL pública: data/public-url.txt. Si el túnel tmux gastos-public-tunnel
// ya corre, reúsala (`npm run public-url`). NUNCA `cloudflared tunnel --url`
// otra vez: cada restart inventa un hostname trycloudflare nuevo.

const auth = authPlugin()

export default defineConfig({
  plugins: [
    auth,
    gastosApiPlugin({
      getUser: (req) => auth.store.userFromRequest(req),
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 4731,
    strictPort: true,
    allowedHosts: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        'data/**',
        '**/*.sqlite',
        '**/*.sqlite-*',
        'server/**',
        'scripts/**',
      ],
    },
  },
  preview: {
    host: '0.0.0.0',
    // Render/Fly inyectan PORT. En local, 4731 para no pelear con `npm run dev` ni el túnel.
    port: Number.parseInt(process.env.PORT || '4731', 10),
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        login: path.resolve(rootDir, 'login.html'),
      },
    },
  },
})
