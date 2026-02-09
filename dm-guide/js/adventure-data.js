// dm-guide/js/adventure-data.js — Shim with mutable reference
// Real data loaded from campaigns/<id>/adventure-data.js at boot.

export const ADVENTURE_DATA = {
  meta: {},
  acts: [],
  npcs: {},
  pcs: {},
  statBlocks: {},
  spells: {},
  dcReference: [],
  loot: [],
  foreshadowing: []
};

export function setAdventureData(data) {
  for (const key of Object.keys(ADVENTURE_DATA)) delete ADVENTURE_DATA[key];
  Object.assign(ADVENTURE_DATA, data);
}
