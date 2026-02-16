import { test, expect } from '@playwright/test';
import { bootDisplay, bootController } from './helpers.js';

test.describe('AuthorityElection', () => {
  let display;

  test.beforeEach(async ({ context }) => {
    // Display boots first so the VTT channel is active
    display = await bootDisplay(context);
  });

  /**
   * Boot a Controller and inject AuthorityElection.
   * The election module isn't wired into Controller boot yet (Task 18),
   * so we inject it dynamically.
   */
  async function bootControllerWithElection(context) {
    const ctrl = await bootController(context);
    // Wait for map dimensions via WELCOME
    await ctrl.waitForFunction(
      () => window.__controller?.camera?.mapW > 0,
      { timeout: 10000 }
    );
    // Inject election
    await ctrl.evaluate(async () => {
      const { AuthorityElection } = await import('/vtt/js/authority-election.js');
      const se = window.__controller.syncEngine;
      window.__controller.election = new AuthorityElection(
        se.windowId, 'controller', se.transport
      );
      window.__controller.election.elect();
    });
    return ctrl;
  }

  test('single Controller becomes authority immediately', async ({ context }) => {
    const ctrl = await bootControllerWithElection(context);
    const isAuth = await ctrl.evaluate(() => window.__controller.election.isAuthority);
    expect(isAuth).toBe(true);
  });

  test('two Controllers: lower windowId is authority', async ({ context }) => {
    const ctrl1 = await bootControllerWithElection(context);
    const ctrl2 = await bootControllerWithElection(context);

    // Wait for AUTHORITY_CLAIM messages to propagate and converge
    await ctrl1.waitForFunction(
      () => {
        const el = window.__controller.election;
        // Converged when only one of the two should be authority.
        // We just need the claims to have been exchanged.
        return el != null;
      },
      { timeout: 3000 }
    );
    // Small delay for message exchange
    await new Promise(r => setTimeout(r, 300));

    const id1 = await ctrl1.evaluate(() => window.__controller.syncEngine.windowId);
    const id2 = await ctrl2.evaluate(() => window.__controller.syncEngine.windowId);
    const auth1 = await ctrl1.evaluate(() => window.__controller.election.isAuthority);
    const auth2 = await ctrl2.evaluate(() => window.__controller.election.isAuthority);

    // Exactly one should be authority — the one with the lower windowId
    if (id1 < id2) {
      expect(auth1).toBe(true);
      expect(auth2).toBe(false);
    } else {
      expect(auth1).toBe(false);
      expect(auth2).toBe(true);
    }
  });

  test('authority Controller closes → survivor becomes authority', async ({ context }) => {
    const ctrl1 = await bootControllerWithElection(context);
    const ctrl2 = await bootControllerWithElection(context);

    // Wait for convergence
    await new Promise(r => setTimeout(r, 300));

    const id1 = await ctrl1.evaluate(() => window.__controller.syncEngine.windowId);
    const id2 = await ctrl2.evaluate(() => window.__controller.syncEngine.windowId);

    let authority, survivor;
    if (id1 < id2) {
      authority = ctrl1;
      survivor = ctrl2;
    } else {
      authority = ctrl2;
      survivor = ctrl1;
    }

    // Close the authority Controller
    await authority.close();

    // Survivor should detect the peer-leave and become authority.
    // GOODBYE is sent on pagehide; if missed, heartbeat timeout is 10s.
    await survivor.waitForFunction(
      () => window.__controller.election.isAuthority === true,
      { timeout: 15000 }
    );
  });

  test('non-controller role does not participate in election', async ({ context }) => {
    // Verify Display-side: election with role='display' does nothing
    const result = await display.evaluate(async () => {
      const { AuthorityElection } = await import('/vtt/js/authority-election.js');
      const se = window.__vtt.syncEngine;
      const election = new AuthorityElection(se.windowId, 'display', se.transport);
      election.elect();
      const isAuth = election.isAuthority;
      election.destroy();
      return isAuth;
    });
    expect(result).toBe(false);
  });
});
