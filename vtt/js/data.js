// ============================================
// VTT Data — Scene, map, token, effect definitions
// ============================================

// --- SCENES (26 total) ---
// Art will be generated via ChatGPT; paths are placeholders until files exist
export const SCENES = [
  // Act 1: The Job Offer
  { id: 'S01', act: 1, title: 'The Rusty Anchor',      art: 'assets/scenes/s01-rusty-anchor.jpg',    overlay: 'A salt-crusted tavern on the docks. Lantern light cuts through harbor fog.' },
  { id: 'S02', act: 1, title: "Locke's Proposition",    art: 'assets/scenes/s02-locke-booth.png',     overlay: null },

  // Act 2: Gathering Intel
  { id: 'S03', act: 2, title: 'Dock District',          art: 'assets/scenes/s03-dock-district.png',   overlay: null },
  { id: 'S04', act: 2, title: 'Veymar Estate (Distant)',art: 'assets/scenes/s04-veymar-distant.png',  overlay: null },
  { id: 'S05', act: 2, title: 'The Bakery — Pip',       art: 'assets/scenes/s05-bakery-pip.png',      overlay: null },
  { id: 'S06', act: 2, title: 'The Undermarket',        art: 'assets/scenes/s06-undermarket.png',     overlay: null },
  { id: 'S07', act: 2, title: 'The Broken Oar',         art: 'assets/scenes/s07-broken-oar.png',      overlay: null },

  // Act 3: Infiltration
  { id: 'S08', act: 3, title: 'Estate at Night',        art: 'assets/scenes/s08-estate-night.png',    overlay: 'The Veymar estate blazes with amber light. Carriages line the drive. Music drifts from open windows.' },
  { id: 'S09', act: 3, title: 'Main Gate',              art: 'assets/scenes/s09-main-gate.png',       overlay: null },
  { id: 'S10', act: 3, title: "Servants' Entrance",     art: 'assets/scenes/s10-servants-entrance.png', overlay: null },
  { id: 'S11', act: 3, title: 'West Wall',              art: 'assets/scenes/s11-west-wall.png',       overlay: null },
  { id: 'S12', act: 3, title: 'Conservatory',           art: 'assets/scenes/s12-conservatory.png',    overlay: null },

  // Act 4: Mansion Interior
  { id: 'S13', act: 4, title: 'The Ballroom',           art: 'assets/scenes/s13-ballroom.png',        overlay: 'Crystal chandeliers scatter light across a sea of silk and velvet. The orchestra plays a waltz.' },
  { id: 'S14', act: 4, title: "Servants' Corridor",     art: 'assets/scenes/s14-servants-corridor.png', overlay: null },
  { id: 'S15', act: 4, title: 'Rooftop',                art: 'assets/scenes/s15-rooftop.png',         overlay: null },
  { id: 'S16', act: 4, title: 'Third-Floor Hallway',    art: 'assets/scenes/s16-third-floor.png',     overlay: null },
  { id: 'S17', act: 4, title: 'Grand Staircase',        art: 'assets/scenes/s17-grand-staircase.png', overlay: null },

  // Act 5: The Puzzle Box
  { id: 'S18', act: 5, title: 'Arcane Ward',            art: 'assets/scenes/s18-arcane-ward.png',     overlay: 'Blue-white threads of magical energy weave across the doorframe, pulsing with quiet menace.' },
  { id: 'S19', act: 5, title: "Veymar's Study",         art: 'assets/scenes/s19-veymar-study.png',    overlay: null },
  { id: 'S20', act: 5, title: 'The Puzzle Box',         art: 'assets/scenes/s20-puzzle-box.png',      overlay: null },
  { id: 'S21', act: 5, title: 'The Swap',               art: 'assets/scenes/s21-the-swap.png',        overlay: null },

  // Act 6: The Ritual
  { id: 'S22', act: 6, title: 'Warehouse Exterior',     art: 'assets/scenes/s22-warehouse-ext.png',   overlay: null },
  { id: 'S23', act: 6, title: 'The Ritual',             art: 'assets/scenes/s23-ritual.png',          overlay: 'A blood circle on the stone floor. Five iron braziers burn with unnatural blue flame. Locke stands at the center.' },
  { id: 'S24', act: 6, title: 'Rakshasa Revealed',      art: 'assets/scenes/s24-rakshasa-reveal.png', overlay: null },
  { id: 'S25', act: 6, title: 'Braziers Burning',       art: 'assets/scenes/s25-braziers.png',        overlay: null },
  { id: 'S26', act: 6, title: 'Epilogue — Dawn',        art: 'assets/scenes/s26-epilogue-dawn.png',   overlay: 'The first light of dawn breaks over the Dock District. The warehouse smolders behind you.' },
];

// Act metadata for title cards
export const ACTS = [
  { number: 1, title: 'The Job Offer',      subtitle: 'A proposition in the Dock District' },
  { number: 2, title: 'Gathering Intel',     subtitle: 'Contacts, rumors, and the estate' },
  { number: 3, title: 'Infiltration',        subtitle: 'Into the Veymar estate' },
  { number: 4, title: 'The Mansion',         subtitle: 'Secrets behind gilded walls' },
  { number: 5, title: 'The Puzzle Box',      subtitle: 'The prize within reach' },
  { number: 6, title: 'The Ritual',          subtitle: 'Betrayal and blood' },
];

// --- MAPS (6 total) ---
export const MAPS = [
  { id: 'M01', title: 'Dock District',       image: 'assets/maps/m01-dock-district.png',    gridSize: 5, cols: 40, rows: 30 },
  { id: 'M02', title: 'Estate Grounds',      image: 'assets/maps/m02-estate-grounds.png',   gridSize: 5, cols: 40, rows: 30 },
  { id: 'M03', title: 'Mansion — Ground',    image: 'assets/maps/m03-mansion-ground.png',   gridSize: 5, cols: 30, rows: 24 },
  { id: 'M04', title: 'Mansion — Second',    image: 'assets/maps/m04-mansion-second.png',   gridSize: 5, cols: 30, rows: 24 },
  { id: 'M05', title: 'Mansion — Third',     image: 'assets/maps/m05-mansion-third.png',    gridSize: 5, cols: 20, rows: 16 },
  { id: 'M06', title: 'Warehouse',           image: 'assets/maps/m06-warehouse.png',        gridSize: 5, cols: 24, rows: 16 },
];

// --- TOKEN DEFINITIONS ---
export const TOKENS = {
  // PCs
  'martin-storm':  { name: 'Martin Storm',        image: 'assets/tokens/martin-storm.png',  border: 'var(--token-pc)',       size: 1, isPC: true },
  'lome':          { name: 'Lome',                 image: 'assets/tokens/lome.png',          border: 'var(--token-pc)',       size: 1, isPC: true },
  'oda':           { name: 'Oda "Bearda"',         image: 'assets/tokens/oda.png',           border: 'var(--token-pc)',       size: 1, isPC: true },
  'jean':          { name: 'Jean LeMarque',        image: 'assets/tokens/jean.png',          border: 'var(--token-pc)',       size: 1, isPC: true },
  'kallista':      { name: 'Kallista',              image: 'assets/tokens/kallista.png',      border: 'var(--token-pc)',       size: 1, isPC: true },
  'oda-bear':      { name: 'Oda (Bear)',           image: 'assets/tokens/oda-bear.png',      border: 'var(--heat-green)',     size: 1, isPC: true },

  // NPCs
  'locke':           { name: 'Locke',              image: 'assets/tokens/locke.png',           border: 'var(--token-npc-neutral)', size: 1 },
  'locke-rakshasa':  { name: 'Locke (Revealed)',   displayName: 'Locke',    image: 'assets/tokens/locke-rakshasa.png',  border: 'var(--token-enemy)',        size: 1 },
  'cult-fanatic':    { name: 'Cult Fanatic',       displayName: 'Cultist',  image: 'assets/tokens/cult-fanatic.png',    border: 'var(--token-enemy)',        size: 1 },
  'guard':           { name: 'Estate Guard',       displayName: 'Guard',    image: 'assets/tokens/guard.png',           border: 'var(--token-npc-hostile)',  size: 1 },
  'captain-helm':    { name: 'Captain Dara Helm',  image: 'assets/tokens/captain-helm.png',    border: 'var(--token-npc-hostile)',  size: 1 },
  'mastiff':         { name: 'Mastiff',            image: 'assets/tokens/mastiff.png',         border: 'var(--token-npc-hostile)',  size: 1 },
  'pip':             { name: 'Pip',                image: 'assets/tokens/pip.png',             border: 'var(--token-npc-friendly)', size: 1 },

  // Objects
  'brazier-lit':    { name: 'Brazier (Lit)',       image: 'assets/tokens/brazier-lit.png',    border: 'var(--brazier-blue)',    size: 1, isObject: true },
  'brazier-dead':   { name: 'Brazier (Dead)',      image: 'assets/tokens/brazier-dead.png',   border: 'var(--brazier-dead)',    size: 1, isObject: true },
  'puzzle-box':     { name: 'Puzzle Box',          image: 'assets/tokens/puzzle-box.png',     border: 'var(--purple)',          size: 1, isObject: true },
  'dagger-magic':   { name: '+1 Ornate Dagger',   image: 'assets/tokens/dagger-magic.png',   border: 'var(--gold)',            size: 1, isObject: true },
};

// --- MAP PRESETS (pre-positioned token layouts) ---
export const MAP_PRESETS = {
  'M06-combat': {
    mapId: 'M06',
    label: 'Warehouse — Final Battle',
    tokens: [
      { tokenId: 'locke-rakshasa', x: 12, y: 8 },
      { tokenId: 'cult-fanatic',   x: 8,  y: 6,  label: 'Fanatic 1' },
      { tokenId: 'cult-fanatic',   x: 16, y: 6,  label: 'Fanatic 2' },
      { tokenId: 'brazier-lit',    x: 6,  y: 4 },
      { tokenId: 'brazier-lit',    x: 18, y: 4 },
      { tokenId: 'brazier-lit',    x: 6,  y: 12 },
      { tokenId: 'brazier-lit',    x: 18, y: 12 },
      { tokenId: 'brazier-lit',    x: 12, y: 2 },
      // PCs start near entrance
      { tokenId: 'martin-storm',   x: 10, y: 14 },
      { tokenId: 'lome',           x: 12, y: 14 },
      { tokenId: 'oda',            x: 14, y: 14 },
      { tokenId: 'jean',           x: 8,  y: 14 },
      { tokenId: 'kallista',       x: 16, y: 14 },
    ]
  },
  'M02-infiltration': {
    mapId: 'M02',
    label: 'Estate Grounds — Infiltration',
    tokens: [
      { tokenId: 'guard', x: 20, y: 15, label: 'Gate Guard 1' },
      { tokenId: 'guard', x: 21, y: 15, label: 'Gate Guard 2' },
      { tokenId: 'guard', x: 10, y: 20, label: 'Patrol' },
      { tokenId: 'mastiff', x: 30, y: 10, label: 'Mastiff 1' },
      { tokenId: 'mastiff', x: 32, y: 12, label: 'Mastiff 2' },
    ]
  }
};

// --- EFFECT DEFINITIONS ---
export const EFFECTS = {
  'divine-smite':      { name: 'Divine Smite',       type: 'burst',      color: '#FFD700', radius: 1, duration: 600,  shake: true },
  'fireball':          { name: 'Fireball',           type: 'aoe-sphere', color: '#FF4500', radius: 4, duration: 800,  flash: '#FF4500' },
  'counterspell':      { name: 'Counterspell',       type: 'ripple',     color: '#7E57C2', radius: 2, duration: 500 },
  'dispel-magic':      { name: 'Dispel Magic',       type: 'wave',       color: '#48B5E0', radius: 3, duration: 700 },
  'healing-word':      { name: 'Healing Word',       type: 'arc',        color: '#90EE90', duration: 500 },
  'spirit-guardians':  { name: 'Spirit Guardians',   type: 'aura',       color: '#B39DDB', radius: 3, duration: 0, persistent: true },
  'hold-person':       { name: 'Hold Person',        type: 'cage',       color: '#FFD700', duration: 0, persistent: true },
  'cutting-words':     { name: 'Cutting Words',      type: 'soundwave',  color: '#CE93D8', duration: 400 },
  'dominate-person':   { name: 'Dominate Person',    type: 'haze',       color: '#7E57C2', duration: 0, persistent: true },
  'brazier-extinguish':{ name: 'Brazier Extinguish',  type: 'extinguish', color: '#4A9EFF', duration: 1000, shake: true },
  'ritual-activate':   { name: 'Ritual Activation',   type: 'ritual',     color: '#8B0000', duration: 2000, flash: '#5C1A1A' },
  'rakshasa-reveal':   { name: 'Rakshasa Reveal',     type: 'reveal',     color: '#C0392B', duration: 1500, shake: true, flash: '#5C1A1A' },
  'path-grave-smite':  { name: 'Path + Smite Combo',  type: 'combo',      color: '#FFD700', duration: 2000, shake: true, flash: '#FFD700' },
  'invisibility':      { name: 'Invisibility',        type: 'fade',       color: '#48B5E0', duration: 600 },
};

// Keyboard shortcut for triggering effects (number row)
export const EFFECT_HOTKEYS = {
  '1': 'divine-smite',
  '2': 'fireball',
  '3': 'counterspell',
  '4': 'healing-word',
  '5': 'spirit-guardians',
  '6': 'brazier-extinguish',
  '7': 'ritual-activate',
  '8': 'rakshasa-reveal',
  '9': 'path-grave-smite',
  '0': 'dominate-person',
};

// Scene-to-act mapping helper
export function getActForScene(sceneId) {
  const scene = SCENES.find(s => s.id === sceneId);
  return scene ? ACTS[scene.act - 1] : null;
}

// Get first scene index for a given act number
export function getFirstSceneOfAct(actNumber) {
  return SCENES.findIndex(s => s.act === actNumber);
}
