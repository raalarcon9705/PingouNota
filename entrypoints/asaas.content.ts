import { browser } from 'wxt/browser';
import { asaasAdapter } from '../src/services/adapters';
import type { ExtensionMessage } from '../src/shared/messages';

export default defineContentScript({
  matches: [
    '*://*.asaas.com/customerPayment/index*',
    '*://*.asaas.com/customerPayment/list*',
    '*://*.asaas.com/app/cobranzas*',
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

      const ack = (await browser.runtime.sendMessage(detectedMsg).catch(() => null)) as {
        acknowledged?: boolean;
        scanType?: 'full' | 'incremental';
        scanId?: string;
      } | null;

      const scanId = ack?.scanId || crypto.randomUUID();
      const result = asaasAdapter.parse(document);

      const observedMsg: ExtensionMessage = {
        type: 'PAYMENTS_OBSERVED',
        scanId,
        pageUrl,
        result,
      };

      await browser.runtime.sendMessage(observedMsg).catch(() => {});

      // Continue to next page if supported and user hasn't interacted
      const pagination = asaasAdapter.nextPage(document);
      if (pagination.kind === 'next' && !userInteracted) {
        const nextHref = pagination.href;
        if (asaasAdapter.isSupportedRoute(nextHref)) {
          window.location.href = nextHref;
        }
      }
    } catch (err) {
      console.error('[PingouNota] Asaas content script error:', err);
    }
  },
});
