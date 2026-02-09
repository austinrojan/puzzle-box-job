// ============================================
// VTT Utilities — Shared helper functions
// ============================================

const DEFAULT_BORDER = '#C9A84C';

/**
 * Resolve a CSS custom property reference like 'var(--token-pc)' to its
 * computed value. Returns the raw value if it is not a var() reference,
 * or a gold fallback if the value is missing.
 */
export function resolveCSSVar(value) {
  if (!value || !value.startsWith('var(')) return value || DEFAULT_BORDER;
  const inner = value.slice(4, -1); // strip 'var(' and ')'
  const commaIdx = inner.indexOf(',');
  const varName = commaIdx === -1 ? inner.trim() : inner.slice(0, commaIdx).trim();
  const fallback = commaIdx === -1 ? null : inner.slice(commaIdx + 1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return resolved || fallback || DEFAULT_BORDER;
}
