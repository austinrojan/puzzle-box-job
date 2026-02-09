import { AppState } from './state.js';
import { COMBAT_CONFIG } from './combat-config.js';
import { CAMPAIGN } from '../../shared/campaign-data.js';
import {
  createSceneMsg, createModeSwitchMsg, createMapMsg, createEffectMsg,
  createTitleCardMsg, createCombatStartMsg, createTokenLoadPresetMsg,
  createInitiativeMsg
} from '../../shared/protocol.js';

let _channel = null;

export function initVttSync() {
  try { _channel = new BroadcastChannel(CAMPAIGN.broadcastChannel); } catch (_) { /* not available */ }
}

export function vttSync(msg) {
  _channel?.postMessage(msg);
}

export function fireVttActions(vtt) {
  if (!vtt) return;
  if (vtt.scene)     vttSync(createSceneMsg(vtt.scene));
  if (vtt.mode)      vttSync(createModeSwitchMsg(vtt.mode));
  if (vtt.map)       vttSync(createMapMsg(vtt.map));
  if (vtt.effect)    vttSync(createEffectMsg(vtt.effect));
  if (vtt.titleCard) vttSync(createTitleCardMsg(vtt.titleCard));
  if (vtt.combat)    vttSync(createCombatStartMsg());
  if (vtt.preset)    vttSync(createTokenLoadPresetMsg(vtt.preset));
}

export function syncFullInitiative() {
  vttSync(createInitiativeMsg({
    active: true,
    round: AppState.combat.round,
    currentTurn: AppState.combat.currentTurn,
    entries: AppState.combat.initiative.map((e) => ({
      name: e.name,
      displayName: nameToDisplayName(e.name),
      init: e.init,
      tokenId: nameToTokenId(e.name),
      hp: e.hp,
      maxHp: e.maxHp,
      conditions: e.conditions ?? [],
      isPC: e.type === 'pc',
    })),
  }));
}

export function nameToTokenId(name) {
  return COMBAT_CONFIG.tokenMapping[name]?.tokenId ?? null;
}

export function nameToDisplayName(name) {
  return COMBAT_CONFIG.tokenMapping[name]?.displayName ?? name;
}
