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
  const varName = value.replace('var(', '').replace(')', '');
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || DEFAULT_BORDER;
}
