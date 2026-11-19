import { browser } from 'wxt/browser';
import { asaasAdapter } from '../src/services/scan-coordinator';
import type { ExtensionMessage } from '../src/shared/messages';

export default defineContentScript({
  matches: [
    '*://*.asaas.com/customerPayment/index*',
    '*://*.asaas.com/customerPayment/list*',
    '*://*.asaas.com/app/cobranzas*',
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
        provider: 'asaas',
      };
      browser.runtime.sendMessage(pauseMsg).catch(() => {});
    };

    ['mousedown', 'keydown', 'input'].forEach((evt) => {
      window.addEventListener(evt, onUserActivity, { capture: true, passive: true });
    });

    try {
      const pageUrl = window.location.href;
      if (!asaasAdapter.isSupportedRoute(pageUrl)) {
        return;
      }

      const detectedMsg: ExtensionMessage = {
        type: 'PORTAL_LIST_DETECTED',
        provider: 'asaas',
        pageUrl,
      };

      browser.runtime.sendMessage(detectedMsg).catch(() => {});

      const result = asaasAdapter.parse(document);
      const scanId = crypto.randomUUID();
      const observedMsg: ExtensionMessage = {
        type: 'PAYMENTS_OBSERVED',
        scanId,
        pageUrl,
        result,
      };

      browser.runtime.sendMessage(observedMsg).catch(() => {});
    } catch (err) {
      console.error('[PingouNota] Asaas content script error:', err);
    }
  },
});
