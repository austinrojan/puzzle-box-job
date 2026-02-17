// shared/sync/ISyncTransport.js
// Abstract base class for camera sync transports.
// BroadcastChannel and (future) WebSocket both implement this.

export class ISyncTransport {
  /** @returns {boolean} Whether the transport is currently connected */
  get connected() {
    throw new Error('ISyncTransport.connected not implemented');
  }

  /** @returns {string} Transport type identifier ('broadcast-channel' or 'websocket') */
  get type() {
    throw new Error('ISyncTransport.type not implemented');
  }

  /**
   * Send a message to all connected peers.
   * @param {Object} msg
   */
  send(msg) {
    throw new Error('ISyncTransport.send not implemented');
  }

  /**
   * Register a handler for incoming messages.
   * @param {(msg: Object) => void} handler
   * @returns {Function} Unsubscribe function — call to remove this handler.
   */
  onMessage(handler) {
    throw new Error('ISyncTransport.onMessage not implemented');
  }

  /**
   * Register a handler for connection state changes.
   * @param {(connected: boolean) => void} handler
   */
  onConnectionChange(handler) {
    throw new Error('ISyncTransport.onConnectionChange not implemented');
  }

  /**
   * Open the transport connection.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('ISyncTransport.connect not implemented');
  }

  /** Close the transport connection. */
  disconnect() {
    throw new Error('ISyncTransport.disconnect not implemented');
  }

  /** Clean up all resources. */
  destroy() {
    throw new Error('ISyncTransport.destroy not implemented');
  }
}
