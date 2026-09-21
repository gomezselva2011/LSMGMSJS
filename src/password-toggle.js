const SHOW_LABEL = 'Mostrar contraseña'
const HIDE_LABEL = 'Ocultar contraseña'

export function applyPasswordVisibility(input, toggle, visible) {
  if (!input || !toggle) return
  const selectionStart = input.selectionStart
  const selectionEnd = input.selectionEnd
  input.type = visible ? 'text' : 'password'
  const label = visible ? HIDE_LABEL : SHOW_LABEL
  toggle.setAttribute('aria-pressed', visible ? 'true' : 'false')
  toggle.setAttribute('aria-label', label)
  toggle.setAttribute('title', label)
  toggle.querySelector('.eye-show')?.toggleAttribute('hidden', visible)
  toggle.querySelector('.eye-hide')?.toggleAttribute('hidden', !visible)
  if (typeof input.setSelectionRange !== 'function') return
  try {
    input.setSelectionRange(selectionStart, selectionEnd)
  } catch {
    // Some browsers reject selection on type=password.
  }
}

export function bindPasswordToggle(toggle, input = null) {
  if (!toggle || toggle.dataset.passwordBound === '1') return
  const field =
    input ||
    (toggle.getAttribute('aria-controls')
      ? document.getElementById(toggle.getAttribute('aria-controls'))
      : toggle.closest('[data-password-wrap]')?.querySelector('input'))
  if (!field) return
  toggle.dataset.passwordBound = '1'
  applyPasswordVisibility(field, toggle, field.type === 'text')
  toggle.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    applyPasswordVisibility(field, toggle, field.type === 'password')
  })
}

export function bindPasswordToggles(root = document) {
  root.querySelectorAll('[data-password-toggle]').forEach((toggle) => bindPasswordToggle(toggle))
}
