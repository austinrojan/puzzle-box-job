// dm-guide/js/combat-config.js — Shim with mutable reference
// Real data loaded from campaigns/<id>/combat.js at boot.

export const COMBAT_CONFIG = {
  defaultState: {},
  defaultInitiative: [],
  immunityTable: [],
  phases: [],
  tokenMapping: {},
  dominate: {},
  migrations: []
};

export function setCombatConfig(config) {
  for (const key of Object.keys(COMBAT_CONFIG)) delete COMBAT_CONFIG[key];
  Object.assign(COMBAT_CONFIG, config);
}
