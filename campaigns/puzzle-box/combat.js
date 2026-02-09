// Campaign combat configuration — The Puzzle-Box Job
// Defines all encounter-specific state, mechanics, and UI layout.

export const COMBAT_CONFIG = {
  // Default combat state (merged into AppState.combat at boot)
  defaultState: {
    active: false,
    round: 1,
    currentTurn: 0,
    initiative: [],
    combatants: {
      locke: { hp: 110, maxHp: 110 },
      cultFanatics: [
        { hp: 33, maxHp: 33 },
        { hp: 33, maxHp: 33 }
      ]
    },
    mechanics: {
      braziers: [true, true, true, true, true],
      dominate: { active: false, auraWithParty: true }
    }
  },

  // Default initiative roster (nulls filled by DM during play)
  defaultInitiative: [
    { name: 'Lair Action',       init: 20, type: 'lair',  conditions: [] },
    { name: 'Kallista',          init: null, type: 'pc',   conditions: [] },
    { name: 'Martin Storm',      init: null, type: 'pc',   conditions: [] },
    { name: 'Locke (Rakshasa)',  init: 14,  type: 'enemy', conditions: [] },
    { name: 'Oda (Bearda)',      init: null, type: 'pc',   conditions: [] },
    { name: 'Cult Fanatic 1',    init: 10,  type: 'enemy', conditions: [] },
    { name: 'Cult Fanatic 2',    init: 10,  type: 'enemy', conditions: [] },
    { name: 'Jean LeMarque',     init: null, type: 'pc',   conditions: [] },
    { name: 'L\u00F3m\u00EB',             init: null, type: 'pc',   conditions: [] }
  ],

  // Immunity table (index = number of braziers extinguished)
  immunityTable: [
    { label: 'Immune to 3rd level and below', spells: 'Physical attacks only' },
    { label: 'Immune to 2nd level and below', spells: '3rd-level: Counterspell, Fireball, Dispel Magic, Spirit Guardians' },
    { label: 'Immune to 1st level and below', spells: '2nd-level+: Hold Person, Suggestion, Heat Metal' },
    { label: 'Immune to cantrips only', spells: "1st-level+: Command, Tasha's Hideous Laughter" },
    { label: 'No spell immunity', spells: 'Everything works \u2014 full arsenal' }
  ],

  // Boss phase triggers
  phases: [
    { id: 'phase-1', label: 'Phase 1', hpThreshold: 0.5, above: true },
    { id: 'phase-2', label: 'Phase 2: Melee Frenzy', hpThreshold: 0.5, above: false,
      description: 'Drops spellcasting, two claw attacks per turn' }
  ],

  // Name → token ID mapping for initiative sync
  tokenMapping: {
    'Martin Storm':       { tokenId: 'martin-storm' },
    'L\u00F3m\u00EB':              { tokenId: 'lome' },
    'Oda (Bearda)':       { tokenId: 'oda' },
    'Jean LeMarque':      { tokenId: 'jean' },
    'Kallista':           { tokenId: 'kallista' },
    'Locke (Rakshasa)':   { tokenId: 'locke-rakshasa', displayName: 'Locke' },
    'Cult Fanatic 1':     { tokenId: 'cult-fanatic',   displayName: 'Cultist 1' },
    'Cult Fanatic 2':     { tokenId: 'cult-fanatic',   displayName: 'Cultist 2' },
    'Lair Action':        { tokenId: null,              displayName: 'Lair Action' }
  },

  // Dominate mechanic metadata
  dominate: {
    targetName: 'Jean LeMarque',
    targetShort: 'Jean',
    save: 'WIS',
    dc: 15,
    description: {
      active: 'Aura of Protection has LEFT the party (+3 saves gone). Break: Dispel Magic on Jean (d20+7 vs DC 15, needs 8+), or damage Jean for re-save.',
      inactive: null
    }
  },

  // Initiative migration rules (rename old saved names to current)
  migrations: [
    { from: 'Rogue (TBD)', to: 'Kallista' }
  ]
};
