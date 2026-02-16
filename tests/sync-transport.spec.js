import { test, expect } from '@playwright/test';
import { gotoVTT } from './helpers.js';

test.describe('BroadcastChannelTransport', () => {

  test.beforeEach(async ({ page }) => {
    await gotoVTT(page);
  });

  test('connected is false before connect(), true after', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const t = new BroadcastChannelTransport('test-transport-1');
      const before = t.connected;
      await t.connect();
      const after = t.connected;
      t.destroy();
      return { before, after };
    });
    expect(result.before).toBe(false);
    expect(result.after).toBe(true);
  });

  test('send() after connect() does not throw', async ({ page }) => {
    const threw = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const t = new BroadcastChannelTransport('test-transport-2');
      await t.connect();
      try {
        t.send({ type: 'test', data: 123 });
        t.destroy();
        return false;
      } catch (e) {
        t.destroy();
        return true;
      }
    });
    expect(threw).toBe(false);
  });

  test('send() before connect() logs warning but does not crash', async ({ page }) => {
    const threw = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const t = new BroadcastChannelTransport('test-transport-3');
      try {
        t.send({ type: 'test' });
        t.destroy();
        return false;
      } catch (e) {
        t.destroy();
        return true;
      }
    });
    expect(threw).toBe(false);
  });

  test('disconnect() sets connected to false', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const t = new BroadcastChannelTransport('test-transport-4');
      await t.connect();
      const before = t.connected;
      t.disconnect();
      const after = t.connected;
      t.destroy();
      return { before, after };
    });
    expect(result.before).toBe(true);
    expect(result.after).toBe(false);
  });

  test('onConnectionChange fires on connect() and disconnect()', async ({ page }) => {
    const events = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const t = new BroadcastChannelTransport('test-transport-5');
      const log = [];
      t.onConnectionChange((connected) => log.push(connected));
      await t.connect();
      t.disconnect();
      t.destroy();
      return log;
    });
    expect(events).toEqual([true, false]);
  });

  test('two transports on same channel: one sends, other receives', async ({ page }) => {
    const received = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const sender = new BroadcastChannelTransport('test-transport-6');
      const receiver = new BroadcastChannelTransport('test-transport-6');

      return new Promise((resolve) => {
        receiver.onMessage((msg) => {
          sender.destroy();
          receiver.destroy();
          resolve(msg);
        });

        receiver.connect().then(() => {
          sender.connect().then(() => {
            sender.send({ type: 'hello', value: 42 });
          });
        });

        // Timeout safety
        setTimeout(() => {
          sender.destroy();
          receiver.destroy();
          resolve(null);
        }, 3000);
      });
    });
    expect(received).not.toBeNull();
    expect(received.type).toBe('hello');
    expect(received.value).toBe(42);
  });

  test('destroy() cleans up — no further messages received', async ({ page }) => {
    const receivedAfterDestroy = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const sender = new BroadcastChannelTransport('test-transport-7');
      const receiver = new BroadcastChannelTransport('test-transport-7');
      const messages = [];

      receiver.onMessage((msg) => messages.push(msg));

      await receiver.connect();
      await sender.connect();

      // Send one message, verify it arrives
      sender.send({ type: 'before' });
      await new Promise(r => setTimeout(r, 100));

      // Destroy receiver, send another message
      receiver.destroy();
      sender.send({ type: 'after' });
      await new Promise(r => setTimeout(r, 100));

      sender.destroy();
      return messages.map(m => m.type);
    });
    expect(receivedAfterDestroy).toEqual(['before']);
  });

  test('type getter returns broadcast-channel', async ({ page }) => {
    const type = await page.evaluate(async () => {
      const { BroadcastChannelTransport } = await import('/shared/sync/BroadcastChannelTransport.js');
      const t = new BroadcastChannelTransport('test-transport-8');
      const result = t.type;
      t.destroy();
      return result;
    });
    expect(type).toBe('broadcast-channel');
  });
});
