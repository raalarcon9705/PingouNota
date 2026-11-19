import { parseHuskyPayments } from '../src/parsers/husky-parser';
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
    try {
      const pageUrl = window.location.href;
      const detectedMsg: ExtensionMessage = {
        type: 'PORTAL_LIST_DETECTED',
        provider: 'husky',
        pageUrl,
      };

      const runtime =
        typeof browser !== 'undefined' && browser.runtime
          ? browser.runtime
          : typeof chrome !== 'undefined'
            ? chrome.runtime
            : undefined;

      if (!runtime) return;

      runtime.sendMessage(detectedMsg).catch(() => {});

      const result = parseHuskyPayments(document);
      const scanId = crypto.randomUUID();
      const observedMsg: ExtensionMessage = {
        type: 'PAYMENTS_OBSERVED',
        scanId,
        pageUrl,
        result,
      };

      runtime.sendMessage(observedMsg).catch(() => {});
    } catch (err) {
      console.error('[PingouNota] Husky content script error:', err);
    }
  },
});
