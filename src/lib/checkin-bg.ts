/**
 * Normaliza el token de fondo del kiosk (hex o presets legacy) y calcula si conviene tema claro.
 */
export function resolveCheckinBackground(raw: string): { css: string; isLight: boolean } {
  const t = raw.trim().toLowerCase()
  if (t === 'white') return { css: '#ffffff', isLight: true }
  if (t === 'black') return { css: '#000000', isLight: false }
  if (t === 'graphite') return { css: '#3f3f46', isLight: false }

  let hex = t.startsWith('#') ? t : `#${t}`
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  if (hex.length !== 7) {
    return { css: '#3f3f46', isLight: false }
  }
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    return { css: '#3f3f46', isLight: false }
  }
  const luminance = (r * 299 + g * 587 + b * 114) / 1000
  return { css: hex, isLight: luminance > 165 }
}
