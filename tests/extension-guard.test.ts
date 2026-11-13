import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  EXTENSION_GUARD_INLINE_SCRIPT,
  isBrowserExtensionError,
} from '../client/extension-guard-script';

test('isBrowserExtensionError suppresses MetaMask & extension stacks without masking app errors', () => {
  assert.equal(
    isBrowserExtensionError({
      message: 'i: Failed to connect to MetaMask',
      stack:
        'Error: Failed to connect to MetaMask\n    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:9:6166)',
    }),
    true
  );

  assert.equal(
    isBrowserExtensionError({
      message: 'Unexpected token',
      filename: 'moz-extension://1234/contentscript.js',
    }),
    true
  );

  // Must NOT suppress legitimate Fetan P2P wallet or API errors
  assert.equal(
    isBrowserExtensionError({
      message: 'Insufficient wallet balance to lock escrow',
      stack: 'Error\n    at onClick (http://localhost:3000/_next/static/chunks/app/market/page.js:12:4)',
    }),
    false
  );
});

test('EXTENSION_GUARD_INLINE_SCRIPT stops MetaMask rejection before Next dev overlay listener runs', () => {
  type Listener = { fn: (ev: any) => void; capture: boolean };
  const listeners: Record<string, Listener[]> = { unhandledrejection: [], error: [] };

  const fakeWindow: any = {
    addEventListener(type: string, fn: (ev: any) => void, opts?: boolean | { capture?: boolean }) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
      listeners[type].push({ fn, capture });
    },
  };

  function dispatch(type: string, ev: any) {
    let immediateStopped = false;
    ev.preventDefault = () => {
      ev.defaultPrevented = true;
    };
    ev.stopImmediatePropagation = () => {
      immediateStopped = true;
    };

    // Execute capture listeners first, then bubble listeners (standard DOM ordering)
    const ordered = [
      ...listeners[type].filter((l) => l.capture),
      ...listeners[type].filter((l) => !l.capture),
    ];
    for (const listener of ordered) {
      if (immediateStopped) break;
      listener.fn(ev);
    }
  }

  vm.runInNewContext(EXTENSION_GUARD_INLINE_SCRIPT, { window: fakeWindow });

  let nextOverlaySawMetaMask = false;
  let nextOverlaySawAppError = false;

  // Simulate Next.js react-dev-overlay attaching its bubbling-phase listeners later
  fakeWindow.addEventListener('unhandledrejection', (ev: any) => {
    const msg = String(ev.reason?.message || '');
    if (msg.includes('MetaMask')) nextOverlaySawMetaMask = true;
    if (msg.includes('Escrow lock failed')) nextOverlaySawAppError = true;
  });

  const metaMaskErr = new Error('i: Failed to connect to MetaMask');
  metaMaskErr.stack =
    'Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:9:6166)';
  const metaMaskEv: any = { reason: metaMaskErr, defaultPrevented: false };
  dispatch('unhandledrejection', metaMaskEv);

  assert.equal(metaMaskEv.defaultPrevented, true);
  assert.equal(nextOverlaySawMetaMask, false);

  const appEv: any = {
    reason: new Error('Escrow lock failed on /api/orders'),
    defaultPrevented: false,
  };
  dispatch('unhandledrejection', appEv);

  assert.equal(appEv.defaultPrevented, false);
  assert.equal(nextOverlaySawAppError, true);
});

