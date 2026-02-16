// vtt/js/authority-election.js
// Deterministic authority election for multi-Controller coordination.
//
// "Lowest windowId wins" — simplified Bully algorithm.
// Only Controllers participate; Displays observe.
// When the authority disconnects, the next-lowest Controller claims.

import { EventBus } from './state.js';
import { createAuthorityClaimMsg, MSG } from '../../shared/protocol.js';

export class AuthorityElection {
  /**
   * @param {string} windowId - This window's unique ID
   * @param {string} role - 'controller' | 'display' | 'dm-guide'
   * @param {ISyncTransport} transport - For sending/receiving AUTHORITY_CLAIM
   */
  constructor(windowId, role, transport) {
    this._windowId = windowId;
    this._role = role;
    this._transport = transport;
    this._isAuthority = false;
    this._controllerPeers = new Set();

    // Only Controllers participate in election
    if (role === 'controller') {
      this._boundHandleMessage = (msg) => this._handleMessage(msg);
      this._transport.onMessage(this._boundHandleMessage);

      this._boundOnJoin = ({ peerId, peerRole }) => {
        if (peerRole === 'controller') {
          this._controllerPeers.add(peerId);
          this.elect();
        }
      };
      this._boundOnLeave = ({ peerId, peerRole }) => {
        if (peerRole === 'controller') {
          this._controllerPeers.delete(peerId);
          this.elect();
        }
      };
      EventBus.on('camera-sync:peer-join', this._boundOnJoin);
      EventBus.on('camera-sync:peer-leave', this._boundOnLeave);
    }
  }

  get isAuthority() { return this._isAuthority; }

  /**
   * Run election: compare all known Controller IDs, claim if lowest.
   * Called on first connect, peer-join, and peer-leave.
   */
  elect() {
    if (this._role !== 'controller') return;

    const allIds = [this._windowId, ...this._controllerPeers].sort();
    const shouldBeAuthority = allIds[0] === this._windowId;

    if (shouldBeAuthority && !this._isAuthority) {
      this._isAuthority = true;
      this._broadcastClaim();
      EventBus.emit('authority:claimed', { windowId: this._windowId });
    } else if (!shouldBeAuthority && this._isAuthority) {
      this._isAuthority = false;
      EventBus.emit('authority:yielded', {
        windowId: this._windowId,
        newAuthority: allIds[0],
      });
    }
  }

  _broadcastClaim() {
    this._transport.send(
      createAuthorityClaimMsg(this._windowId, this._role)
    );
  }

  _handleMessage(msg) {
    if (msg.type !== MSG.AUTHORITY_CLAIM) return;
    if (msg.windowId === this._windowId) return;

    if (msg.windowId < this._windowId) {
      // Their ID is lower — yield
      if (this._isAuthority) {
        this._isAuthority = false;
        EventBus.emit('authority:yielded', {
          windowId: this._windowId,
          newAuthority: msg.windowId,
        });
      }
    } else {
      // Our ID is lower — re-broadcast to assert authority
      if (this._isAuthority) {
        this._broadcastClaim();
      }
    }
  }

  destroy() {
    this._isAuthority = false;
    if (this._boundOnJoin) {
      EventBus.off('camera-sync:peer-join', this._boundOnJoin);
      EventBus.off('camera-sync:peer-leave', this._boundOnLeave);
    }
  }
}
