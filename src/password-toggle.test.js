import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyPasswordVisibility } from './password-toggle.js'

function fakeToggle() {
  const attrs = {}
  const eyes = {
    show: {
      hidden: false,
      toggleAttribute(name, on) {
        if (name === 'hidden') this.hidden = Boolean(on)
      },
    },
    hide: {
      hidden: true,
      toggleAttribute(name, on) {
        if (name === 'hidden') this.hidden = Boolean(on)
      },
    },
  }
  return {
    attrs,
    eyes,
    setAttribute(name, value) {
      attrs[name] = value
    },
    querySelector(selector) {
      if (selector === '.eye-show') return eyes.show
      if (selector === '.eye-hide') return eyes.hide
      return null
    },
  }
}

describe('password visibility toggle', () => {
  it('reveals the typed characters and switches copy to hide', () => {
    const input = { type: 'password', selectionStart: 0, selectionEnd: 0 }
    const toggle = fakeToggle()
    applyPasswordVisibility(input, toggle, true)
    assert.equal(input.type, 'text')
    assert.equal(toggle.attrs['aria-pressed'], 'true')
    assert.equal(toggle.attrs['aria-label'], 'Ocultar contraseña')
    assert.equal(toggle.attrs.title, 'Ocultar contraseña')
    assert.equal(toggle.eyes.show.hidden, true)
    assert.equal(toggle.eyes.hide.hidden, false)
  })

  it('hides the characters again', () => {
    const input = { type: 'text', selectionStart: 2, selectionEnd: 2 }
    const toggle = fakeToggle()
    applyPasswordVisibility(input, toggle, false)
    assert.equal(input.type, 'password')
    assert.equal(toggle.attrs['aria-label'], 'Mostrar contraseña')
    assert.equal(toggle.eyes.show.hidden, false)
    assert.equal(toggle.eyes.hide.hidden, true)
  })
})
