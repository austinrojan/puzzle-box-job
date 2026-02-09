import { ADVENTURE_DATA } from './adventure-data.js';

function trigramScore(query, text) {
  if (query.length < 3) {
    let matches = 0;
    for (let i = 0; i < query.length; i++) {
      if (text.indexOf(query[i]) !== -1) matches++;
    }
    return (matches / query.length) * 40;
  }

  const qTrigrams = {};
  const tTrigrams = {};

  for (let i = 0; i <= query.length - 3; i++) {
    const t = query.substring(i, i + 3);
    qTrigrams[t] = (qTrigrams[t] || 0) + 1;
  }
  for (let i = 0; i <= Math.min(text.length, 500) - 3; i++) {
    const t = text.substring(i, i + 3);
    tTrigrams[t] = (tTrigrams[t] || 0) + 1;
  }

  let shared = 0;
  let total = 0;
  for (const key in qTrigrams) {
    total += qTrigrams[key];
    if (tTrigrams[key]) shared += Math.min(qTrigrams[key], tTrigrams[key]);
  }
  return total > 0 ? (shared / total) * 60 : 0;
}

export const searchIndex = {
  entries: [],

  buildIndex() {
    this.entries = [];

    for (const act of ADVENTURE_DATA.acts) {
      this.entries.push({
        category: 'Acts',
        title: `Act ${act.number}: ${act.title}`,
        text: act.title,
        type: 'act', id: act.id, label: `Act ${act.number}: ${act.title}`
      });

      for (const section of act.sections || []) {
        for (const block of section.blocks || []) {
          const content = block.text || block.details || '';
          if (content.length > 0) {
            this.entries.push({
              category: 'Acts',
              title: section.title + (block.title ? ` \u2014 ${block.title}` : ''),
              text: content,
              preview: content.substring(0, 120),
              type: 'act', id: act.id, scrollTo: section.id,
              label: `Act ${act.number}: ${act.title}`
            });
          }
        }
      }
    }

    for (const key of Object.keys(ADVENTURE_DATA.npcs)) {
      const npc = ADVENTURE_DATA.npcs[key];
      this.entries.push({
        category: 'NPCs',
        title: npc.name,
        text: `${npc.name} ${npc.role} ${npc.personality} ${npc.location} ${npc.details || ''}`,
        preview: `${npc.role} \u2014 ${npc.personality}`,
        type: 'npc', id: key, label: npc.name
      });
    }

    for (const key of Object.keys(ADVENTURE_DATA.statBlocks)) {
      const sb = ADVENTURE_DATA.statBlocks[key];
      const actionText = (sb.actions || []).map(a => `${a.name} ${a.text}`).join(' ');
      this.entries.push({
        category: 'Stat Blocks',
        title: sb.name,
        text: `${sb.name} ${sb.type} ${sb.tactics || ''} ${actionText}`,
        preview: `${sb.type} \u2014 AC ${sb.ac}, HP ${sb.hp}`,
        type: 'statblock', id: key, label: sb.name
      });
    }

    for (const name of Object.keys(ADVENTURE_DATA.spells)) {
      const sp = ADVENTURE_DATA.spells[name];
      this.entries.push({
        category: 'Spells',
        title: name,
        text: `${name} ${sp.school} ${sp.description}`,
        preview: `Level ${sp.level} ${sp.school} \u2014 ${sp.description.substring(0, 80)}`,
        type: 'spell', id: name, label: name
      });
    }

    for (const dc of ADVENTURE_DATA.dcReference) {
      this.entries.push({
        category: 'Reference',
        title: `DC ${dc.dc}: ${dc.check}`,
        text: `${dc.check} DC ${dc.dc} ${dc.notes || ''}`,
        preview: dc.notes || '',
        type: 'reference', id: 'dc-table', label: 'DC Table'
      });
    }
  },

  search(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const results = [];

    for (const entry of this.entries) {
      const haystack = `${entry.title} ${entry.text}`.toLowerCase();
      let score = 0;

      if (haystack.indexOf(q) !== -1) {
        score = 100;
        if (entry.title.toLowerCase().indexOf(q) !== -1) score = 150;
      } else {
        score = trigramScore(q, haystack);
      }

      if (score > 30) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 20).map(r => r.entry);
  }
};
