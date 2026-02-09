import { ADVENTURE_DATA } from './adventure-data.js';
import { AppState } from './state.js';

const $ = (id) => document.getElementById(id);

let _presentationPages = [];
let _presentationIdx = 0;
let _lastVttBlockId = null;
let _fireVttActionsFn = null;

export function setVttActionsFn(fn) { _fireVttActionsFn = fn; }

export function initPresentation() {
  $('presentation-overlay').addEventListener('click', (e) => {
    if (e.target === $('presentation-overlay')) closePresentation();
  });
  $('present-next').addEventListener('click', presentNext);
  $('present-prev').addEventListener('click', presentPrev);
}

export function openPresentation(blockId) {
  const pages = collectPresentationPages(blockId);
  if (pages.length === 0) return;

  _presentationPages = pages;
  _presentationIdx = Math.max(0, pages.findIndex((p) => p.blockId === blockId));
  renderPresentationPage();
  $('presentation-overlay').classList.add('open');
  AppState.presentationBlock = blockId;
}

function collectPresentationPages(blockId) {
  const pages = [];

  for (const act of ADVENTURE_DATA.acts) {
    for (const section of act.sections || []) {
      const foundInSection = (section.blocks || []).some((b) => b.id === blockId);
      if (!foundInSection) continue;

      for (const block of section.blocks || []) {
        if (block.type === 'read-aloud') {
          const paras = (block.text || '').split(/\n\n+/).filter((p) => p.trim());
          for (let i = 0; i < paras.length; i++) {
            pages.push({ type: 'read-aloud', text: paras[i].trim(), blockId: block.id, paraIndex: i, vtt: block.vtt });
          }
        } else if (block.type === 'dm-note' || block.type === 'dm-tip') {
          pages.push({ type: 'dm-note', title: block.title || 'DM Note', text: block.text, blockId: block.id, vtt: block.vtt });
        } else if (block.type === 'skill-check') {
          pages.push({ type: 'skill-check', check: block.check, dc: block.dc, details: block.details || block.text, blockId: block.id, vtt: block.vtt });
        } else if (block.type === 'encounter') {
          pages.push({ type: 'encounter', title: block.title, text: block.text, blockId: block.id, vtt: block.vtt });
        } else if (block.type === 'conditional') {
          pages.push({ type: 'conditional', condition: block.condition, text: block.outcome || block.text, blockId: block.id, vtt: block.vtt });
        } else if (block.type === 'narrative') {
          pages.push({ type: 'narrative', text: block.text, blockId: block.id, vtt: block.vtt });
        }
      }
    }
  }

  if (pages.length === 0) {
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (el) {
      const paras = el.querySelectorAll('p');
      let i = 0;
      for (const p of paras) {
        pages.push({ type: 'read-aloud', text: p.textContent, blockId, paraIndex: i });
        i++;
      }
    }
  }
  return pages;
}

function stripMarkdown(text) {
  return (text || '').replace(/\*\*/g, '').replace(/\*/g, '');
}

function makeInterstitial(typeClass, labelText) {
  const div = document.createElement('div');
  div.className = 'present-interstitial';
  const typeLabel = document.createElement('div');
  typeLabel.className = `interstitial-type ${typeClass}`;
  typeLabel.textContent = labelText;
  div.appendChild(typeLabel);
  return div;
}

function renderPresentationPage() {
  const content = $('presentation-content');
  const page = _presentationPages[_presentationIdx];
  if (!page) return;

  content.textContent = '';

  if (page.type === 'read-aloud') {
    const p = document.createElement('p');
    p.textContent = page.text;
    content.appendChild(p);
  } else if (page.type === 'dm-note' || page.type === 'narrative') {
    const div = makeInterstitial('type-dm-note', page.type === 'dm-note' ? '\u{1F441} DM Note' : 'Narrative');
    const body = document.createElement('div');
    body.textContent = `${page.title ? `${page.title}: ` : ''}${stripMarkdown(page.text).substring(0, 300)}`;
    div.appendChild(body);
    content.appendChild(div);
  } else if (page.type === 'skill-check') {
    const div = makeInterstitial('type-skill-check', '\u{1F3B2} Skill Check');
    const dcEl = document.createElement('span');
    dcEl.className = 'interstitial-dc';
    dcEl.textContent = `DC ${page.dc}`;
    div.appendChild(dcEl);
    const check = document.createElement('span');
    check.textContent = ` ${page.check || ''}`;
    check.style.fontWeight = '600';
    check.style.color = 'var(--text-primary)';
    div.appendChild(check);
    if (page.details) {
      const det = document.createElement('div');
      det.style.marginTop = '8px';
      det.textContent = stripMarkdown(page.details);
      div.appendChild(det);
    }
    content.appendChild(div);
  } else if (page.type === 'encounter') {
    const div = makeInterstitial('type-encounter', '\u2694 Encounter');
    const body = document.createElement('div');
    body.textContent = `${page.title ? `${page.title}: ` : ''}${stripMarkdown(page.text).substring(0, 300)}`;
    div.appendChild(body);
    content.appendChild(div);
  } else if (page.type === 'conditional') {
    const div = makeInterstitial('type-dm-note', '\u2753 Conditional');
    const cond = document.createElement('div');
    cond.style.fontStyle = 'italic';
    cond.style.marginBottom = '6px';
    cond.textContent = page.condition || '';
    div.appendChild(cond);
    const body = document.createElement('div');
    body.textContent = stripMarkdown(page.text).substring(0, 400);
    div.appendChild(body);
    content.appendChild(div);
  }

  // Fire VTT actions when we enter a new block
  if (page.vtt && page.blockId !== _lastVttBlockId) {
    _fireVttActionsFn?.(page.vtt);
    _lastVttBlockId = page.blockId;
  }

  $('presentation-frame').scrollTop = 0;

  const counter = $('presentation-counter');
  counter.textContent = `${_presentationIdx + 1} / ${_presentationPages.length}`;
  $('present-prev').disabled = _presentationIdx === 0;
  const nextBtn = $('present-next');
  nextBtn.textContent = _presentationIdx >= _presentationPages.length - 1 ? 'Done' : 'Next \u2192';
  nextBtn.disabled = false;
}

export function presentNext() {
  if (_presentationIdx >= _presentationPages.length - 1) {
    closePresentation();
  } else {
    _presentationIdx++;
    renderPresentationPage();
  }
}

export function presentPrev() {
  if (_presentationIdx > 0) {
    _presentationIdx--;
    renderPresentationPage();
  }
}

export function closePresentation() {
  $('presentation-overlay').classList.remove('open');
  AppState.presentationBlock = null;
  _presentationPages = [];
  _presentationIdx = 0;
  _lastVttBlockId = null;
}
