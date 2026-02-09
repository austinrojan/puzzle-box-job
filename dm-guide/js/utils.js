let _idCounter = 0;

export function uid() {
  return `id-${++_idCounter}`;
}

export function syncIdCounter(tabs) {
  for (const t of tabs) {
    const m = t.id.match(/^id-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > _idCounter) _idCounter = n;
    }
  }
}

export function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const deepClone = obj => JSON.parse(JSON.stringify(obj));

export function markdownLite(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

export function textToParas(text) {
  if (!text) return '';
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${markdownLite(p.trim())}</p>`)
    .join('');
}
