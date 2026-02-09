// Controller state — mirrors VTT state via BroadcastChannel

export const vttState = {
  mode: 'theater',
  sceneIndex: 0,
  mapId: null,
  heat: 0,
  initiative: { active: false, round: 1, currentTurn: 0, entries: [] },
  presentationMode: false,
  tokens: [],
  gridVisible: true,
};

export let connected = false;
export let sceneIndex = 0;
export let lastSyncTime = 0;

export function setConnected(val) { connected = val; }
export function setSceneIndex(val) { sceneIndex = val; }
export function setLastSyncTime(val) { lastSyncTime = val; }

export function replaceVttState(data) {
  for (const key of Object.keys(vttState)) delete vttState[key];
  Object.assign(vttState, data);
}
