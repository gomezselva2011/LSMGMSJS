#!/usr/bin/env node
/**
 * Production entry: Vite preview (API plugins + static dist).
 * Binds 0.0.0.0 and process.env.PORT (Render/Fly). Local fallback: 4731.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const port = String(process.env.PORT || '4731')
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const child = spawn(
  process.execPath,
  [viteBin, 'preview', '--host', '0.0.0.0', '--port', port, '--strictPort'],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
