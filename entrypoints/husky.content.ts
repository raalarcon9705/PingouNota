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
  async main() {
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

      const ack = (await browser.runtime.sendMessage(detectedMsg).catch(() => null)) as {
        acknowledged?: boolean;
        scanType?: 'full' | 'incremental';
        scanId?: string;
      } | null;

      const scanId = ack?.scanId || crypto.randomUUID();
      const result = huskyAdapter.parse(document);

      const observedMsg: ExtensionMessage = {
        type: 'PAYMENTS_OBSERVED',
        scanId,
        pageUrl,
        result,
      };

      await browser.runtime.sendMessage(observedMsg).catch(() => {});

      // Continue to next page if supported and user hasn't interacted
      const pagination = huskyAdapter.nextPage(document);
      if (pagination.kind === 'next' && !userInteracted) {
        const nextHref = pagination.href;
        if (huskyAdapter.isSupportedRoute(nextHref)) {
          window.location.href = nextHref;
        }
      }
    } catch (err) {
      console.error('[PingouNota] Husky content script error:', err);
    }
  },
});
