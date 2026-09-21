import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_MARK_SRC,
  MARK_PLACEHOLDER_SRC,
  applyPhotoFallback,
  fallbackPhotoSrc,
  photoSrc,
  setPhotoSrc,
} from './photo.js'

describe('photoSrc', () => {
  it('uses the L&M mark when the user has no photoUrl', () => {
    assert.equal(photoSrc(null), DEFAULT_MARK_SRC)
    assert.equal(photoSrc({}), DEFAULT_MARK_SRC)
  })

  it('uses the saved photo URL and can cache-bust it', () => {
    const url = '/api/users/usr_x/photo'
    assert.equal(photoSrc({ photoUrl: url }), url)
    assert.match(photoSrc({ photoUrl: url }, true), /^\/api\/users\/usr_x\/photo\?t=\d+$/)
  })
})

describe('fallbackPhotoSrc', () => {
  it('falls back to the mark, then to an inline L&M placeholder', () => {
    assert.equal(fallbackPhotoSrc('/api/users/usr_x/photo'), DEFAULT_MARK_SRC)
    assert.equal(fallbackPhotoSrc(`${DEFAULT_MARK_SRC}?t=1`), MARK_PLACEHOLDER_SRC)
    assert.equal(fallbackPhotoSrc(MARK_PLACEHOLDER_SRC), MARK_PLACEHOLDER_SRC)
    assert.equal(fallbackPhotoSrc(''), MARK_PLACEHOLDER_SRC)
  })
})

describe('applyPhotoFallback', () => {
  it('replaces a broken src with the mark and never loops', () => {
    const listeners = []
    const img = {
      dataset: {},
      classList: {
        added: [],
        add(name) {
          this.added.push(name)
        },
        remove() {},
      },
      src: '/api/users/usr_x/photo',
      currentSrc: '/api/users/usr_x/photo',
      getAttribute(name) {
        return name === 'src' ? this.src : null
      },
      addEventListener(type, fn) {
        listeners.push({ type, fn })
      },
    }
    applyPhotoFallback(img)
    assert.equal(img.dataset.photoFallback, '1')
    listeners[0].fn()
    assert.equal(img.src, DEFAULT_MARK_SRC)
    img.currentSrc = DEFAULT_MARK_SRC
    listeners[0].fn()
    assert.equal(img.src, MARK_PLACEHOLDER_SRC)
    assert.equal(img.classList.added.includes('photo-missing'), true)
  })

  it('setPhotoSrc writes the new url and binds the fallback', () => {
    const img = {
      dataset: {},
      classList: { added: [], add() {}, remove() {} },
      src: DEFAULT_MARK_SRC,
      addEventListener() {},
    }
    setPhotoSrc(img, '/api/users/usr_x/photo')
    assert.equal(img.src, '/api/users/usr_x/photo')
    assert.equal(img.dataset.photoFallback, '1')
  })
})
