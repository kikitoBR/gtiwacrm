/**
 * Validates an avatar URL to ensure it is safe to load.
 * WhatsApp CDN URLs (pps.whatsapp.net) contain an `oe` parameter (Unix timestamp in hex).
 * Once that timestamp has passed, the CDN returns HTTP 403 Forbidden.
 * By checking the timestamp before rendering, we prevent 403 errors from flooding the console.
 */
export function isValidAvatarUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/')) {
    return false
  }

  // Check WhatsApp signed CDN expiration
  if (trimmed.includes('pps.whatsapp.net')) {
    const match = trimmed.match(/[?&]oe=([0-9a-fA-F]+)/)
    if (match) {
      const expirationMs = parseInt(match[1], 16) * 1000
      if (Number.isFinite(expirationMs) && expirationMs < Date.now()) {
        return false
      }
    }
  }

  return true
}
