import { browser } from 'wxt/browser';
import { huskyAdapter } from '../src/services/scan-coordinator';
import type { ExtensionMessage } from '../src/shared/messages';

export default defineContentScript({
  matches: [
    '*://*.husky.io/transfers*',
    '*://*.husky.io/payments*',
    '*://*.husky.io/dashboard*',
    '*://*.husky.io/app/transfers*',
  ],
  runAt: 'document_idle',
  main() {
    let userInteracted = false;

    const onUserActivity = () => {
      if (userInteracted) return;
      userInteracted = true;
      const pauseMsg: ExtensionMessage = {
        type: 'SCAN_CONTROL',
        action: 'pause',
        provider: 'husky',
      };
      browser.runtime.sendMessage(pauseMsg).catch(() => {});
    };

    ['mousedown', 'keydown', 'input'].forEach((evt) => {
      window.addEventListener(evt, onUserActivity, { capture: true, passive: true });
    });

    try {
      const pageUrl = window.location.href;
      if (!huskyAdapter.isSupportedRoute(pageUrl)) {
        return;
      }

      const detectedMsg: ExtensionMessage = {
        type: 'PORTAL_LIST_DETECTED',
        provider: 'husky',
        pageUrl,
      };

      browser.runtime.sendMessage(detectedMsg).catch(() => {});

      const result = huskyAdapter.parse(document);
      const scanId = crypto.randomUUID();
      const observedMsg: ExtensionMessage = {
        type: 'PAYMENTS_OBSERVED',
        scanId,
        pageUrl,
        result,
      };

      browser.runtime.sendMessage(observedMsg).catch(() => {});
    } catch (err) {
      console.error('[PingouNota] Husky content script error:', err);
    }
  },
});
