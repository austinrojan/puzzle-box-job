// VTT Utilities

const DEFAULT_BORDER = '#C9A84C';

/** Resolve 'var(--name)' to its computed value, with gold fallback. */
export function resolveCSSVar(value) {
  if (!value || !value.startsWith('var(')) return value || DEFAULT_BORDER;
  const inner = value.slice(4, -1); // strip 'var(' and ')'
  const commaIdx = inner.indexOf(',');
  const varName = commaIdx === -1 ? inner.trim() : inner.slice(0, commaIdx).trim();
  const fallback = commaIdx === -1 ? null : inner.slice(commaIdx + 1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return resolved || fallback || DEFAULT_BORDER;
}
