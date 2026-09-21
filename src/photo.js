export const DEFAULT_MARK_SRC = '/lm-mark.jpg'

export const MARK_PLACEHOLDER_SRC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#f7f4ee"/><text x="48" y="56" text-anchor="middle" font-family="Georgia,serif" font-size="20" fill="#1b2a4e">L&amp;M</text></svg>',
  )

export function photoSrc(user, bust = false) {
  const url = user?.photoUrl || DEFAULT_MARK_SRC
  if (!bust) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}t=${Date.now()}`
}

export function fallbackPhotoSrc(currentSrc = '') {
  const src = String(currentSrc || '').split('?')[0]
  if (!src || src.startsWith('data:') || src === DEFAULT_MARK_SRC) return MARK_PLACEHOLDER_SRC
  return DEFAULT_MARK_SRC
}

export function applyPhotoFallback(img) {
  if (!img || img.dataset?.photoFallback === '1') return img
  if (img.dataset) {
    img.dataset.photoFallback = '1'
    delete img.dataset.lmfb
  }
  img.addEventListener('error', () => {
    const next = fallbackPhotoSrc(img.currentSrc || img.getAttribute?.('src') || img.src || '')
    const current = img.getAttribute?.('src') || img.src || ''
    if (current === next) {
      img.classList?.add?.('photo-missing')
      return
    }
    img.src = next
    if (next.startsWith('data:')) img.classList?.add?.('photo-missing')
  })
  return img
}

export function setPhotoSrc(img, src) {
  if (!img) return
  img.classList?.remove?.('photo-missing')
  if (img.dataset) delete img.dataset.lmfb
  applyPhotoFallback(img)
  img.src = src
}

export function bindPhotoFallbacks(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null)
  if (!doc?.querySelectorAll) return
  doc
    .querySelectorAll(
      '[data-photo], #account-photo, #account-dialog-photo, .boot-hero, .brand-logo, .profile-row img',
    )
    .forEach(applyPhotoFallback)
}
