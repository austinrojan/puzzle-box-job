// Controller sync — BroadcastChannel communication with VTT

import { CAMPAIGN } from '../../shared/campaign-data.js';
import { MSG, createStateRequestMsg } from '../../shared/protocol.js';
import {
  vttState, connected, sceneIndex, lastSyncTime,
  setConnected, setSceneIndex, setLastSyncTime, replaceVttState
} from './state.js';

let _channel = null;
let _onSync = null;

export function send(msg) {
  console.log('[Controller] BC sending:', msg.type, msg);
  _channel?.postMessage(msg);
}

export function initSync(onSync) {
  _onSync = onSync;
  _channel = new BroadcastChannel(CAMPAIGN.broadcastChannel);

  _channel.onmessage = (e) => {
    console.log('[Controller] BC received:', e.data.type);
    if (e.data.type === MSG.STATE_SYNC) {
      console.log('[Controller] State sync, mode:', e.data.data.mode);
      replaceVttState(e.data.data);
      setLastSyncTime(Date.now());
      if (!connected) {
        setConnected(true);
        _onSync?.('connected');
      }
      setSceneIndex(vttState.sceneIndex || 0);
      _onSync?.('update');
    }
  };

  // Request initial state
  send(createStateRequestMsg());

  // Heartbeat: periodically request state and detect VTT disconnection
  setInterval(() => {
    send(createStateRequestMsg());
    if (connected && lastSyncTime > 0 && (Date.now() - lastSyncTime) > 4000) {
      setConnected(false);
      _onSync?.('disconnected');
    }
  }, 1500);
}
