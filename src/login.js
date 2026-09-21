import { bindPasswordToggles } from './password-toggle.js'
import { bindPhotoFallbacks } from './photo.js'

const form = document.querySelector('#login-form')
const errorEl = document.querySelector('#login-error')
const submit = document.querySelector('#login-submit')

bindPasswordToggles()
bindPhotoFallbacks()

function showError(message) {
  if (!errorEl) return
  errorEl.hidden = !message
  errorEl.textContent = message || ''
}

try {
  const me = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
  if (me.ok) {
    window.location.replace('/')
  }
} catch {
  // Stay on the login page if the session check fails.
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault()
  showError('')
  const username = document.querySelector('#login-username')?.value.trim() ?? ''
  const password = document.querySelector('#login-password')?.value ?? ''
  if (!username || !password) {
    showError('Escribe tu usuario y contraseña.')
    return
  }
  if (submit) submit.disabled = true
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      showError(body.error || 'No se pudo entrar.')
      return
    }
    window.location.replace('/')
  } catch {
    showError('No hay conexión con el servidor.')
  } finally {
    if (submit) submit.disabled = false
  }
})
