export interface ExtensionErrorContext {
  message?: string;
  stack?: string;
  filename?: string;
}

const EXTENSION_STACK_MARKERS = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'safari-web-extension://',
  'inpage.js',
  'contentscript.js',
  'evmask.js',
];

const EXTENSION_MESSAGE_MARKERS = [
  'failed to connect to metamask',
  'metamask',
  'extension context invalidated',
];

/**
 * Returns true only for errors originating from external browser extensions
 * (such as MetaMask inpage.js) so Next.js dev overlay and runtime handlers
 * ignore third-party wallet injection noise without hiding real app errors.
 */
export function isBrowserExtensionError(ctx: ExtensionErrorContext): boolean {
  const msg = String(ctx.message || '').toLowerCase();
  const stack = String(ctx.stack || '').toLowerCase();
  const filename = String(ctx.filename || '').toLowerCase();

  return (
    EXTENSION_STACK_MARKERS.some(
      (marker) => stack.includes(marker) || filename.includes(marker)
    ) ||
    EXTENSION_MESSAGE_MARKERS.some((marker) => msg.includes(marker))
  );
}

/**
 * Synchronous capture-phase bootstrap executed in <head> before Next.js
 * attaches react-dev-overlay listeners or hydration runs.
 */
export const EXTENSION_GUARD_INLINE_SCRIPT = `
(function(){
  if (typeof window === 'undefined' || window.__fetanExtensionGuard) return;
  window.__fetanExtensionGuard = true;
  var stackMarkers = ${JSON.stringify(EXTENSION_STACK_MARKERS)};
  var msgMarkers = ${JSON.stringify(EXTENSION_MESSAGE_MARKERS)};
  function isExt(msg, stack, filename) {
    var m = String(msg || '').toLowerCase();
    var s = String(stack || '').toLowerCase();
    var f = String(filename || '').toLowerCase();
    for (var i = 0; i < stackMarkers.length; i++) {
      if (s.indexOf(stackMarkers[i]) !== -1 || f.indexOf(stackMarkers[i]) !== -1) return true;
    }
    for (var j = 0; j < msgMarkers.length; j++) {
      if (m.indexOf(msgMarkers[j]) !== -1) return true;
    }
    return false;
  }
  window.addEventListener('unhandledrejection', function(ev) {
    var r = ev && ev.reason;
    var msg = r && typeof r === 'object' && 'message' in r ? r.message : r;
    var stack = r && typeof r === 'object' && 'stack' in r ? r.stack : '';
    if (isExt(msg, stack, '')) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('error', function(ev) {
    var err = ev && ev.error;
    var msg = (ev && ev.message) || (err && err.message) || '';
    var stack = (err && err.stack) || '';
    var filename = (ev && ev.filename) || '';
    if (isExt(msg, stack, filename)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
})();
`.trim();

