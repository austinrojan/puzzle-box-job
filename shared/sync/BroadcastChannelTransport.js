// shared/sync/BroadcastChannelTransport.js
// Concrete ISyncTransport wrapping BroadcastChannel.

import { ISyncTransport } from './ISyncTransport.js';

export class BroadcastChannelTransport extends ISyncTransport {
  constructor(channelName) {
    super();
    this._channelName = channelName;
    this._channel = null;
    this._messageHandlers = [];
    this._connectionHandlers = [];
  }

  get connected() { return this._channel !== null; }
  get type() { return 'broadcast-channel'; }

  send(msg) {
    if (!this._channel) {
      console.warn('[BCTransport] Cannot send: channel not connected');
      return;
    }
    this._channel.postMessage(msg);
  }

  onMessage(handler) {
    this._messageHandlers.push(handler);
    return () => {
      this._messageHandlers = this._messageHandlers.filter(h => h !== handler);
    };
  }

  onConnectionChange(handler) {
    this._connectionHandlers.push(handler);
  }

  async connect() {
    if (this._channel) return; // already connected

    this._channel = new BroadcastChannel(this._channelName);
    this._channel.onmessage = (event) => {
      for (const handler of this._messageHandlers) {
        handler(event.data);
      }
    };

    // BroadcastChannel is "connected" immediately upon creation
    for (const handler of this._connectionHandlers) {
      handler(true);
    }
  }

  disconnect() {
    if (!this._channel) return;
    this._channel.close();
    this._channel = null;

    for (const handler of this._connectionHandlers) {
      handler(false);
    }
  }

  destroy() {
    this.disconnect();
    this._messageHandlers = [];
    this._connectionHandlers = [];
  }
}
