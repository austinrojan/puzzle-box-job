// shared/sync/debug-transport.js
// Wraps an ISyncTransport with color-coded console logging.
// Only active when localStorage.getItem('debug-sync') === 'true'.
// Zero overhead when disabled.

/**
 * Decorates a transport with color-coded console logging.
 * Returns the original transport if debug is not enabled.
 *
 * @param {ISyncTransport} transport
 * @param {string} label - e.g. 'Controller', 'Display'
 * @returns {ISyncTransport}
 */
export function wrapWithDebugLogging(transport, label) {
  if (typeof localStorage === 'undefined') return transport;
  if (localStorage.getItem('debug-sync') !== 'true') return transport;

  const originalSend = transport.send.bind(transport);
  transport.send = (msg) => {
    console.log(
      `%c[${label}] >> ${msg.type}`,
      'color: #4CAF50; font-weight: bold',
      { senderId: msg.senderId, seq: msg.seq }
    );
    originalSend(msg);
  };

  const originalOnMessage = transport.onMessage.bind(transport);
  transport.onMessage = (handler) => {
    originalOnMessage((msg) => {
      const from = (msg.senderId || msg.windowId || '?').slice(0, 6);
      console.log(
        `%c[${label}] << ${msg.type} from ${from}`,
        'color: #2196F3; font-weight: bold',
        { seq: msg.seq }
      );
      handler(msg);
    });
  };

  return transport;
}
