import { browser } from 'wxt/browser';
import { parseAsaasPayments } from '../src/parsers/asaas-parser';
import type { ExtensionMessage } from '../src/shared/messages';

export default defineContentScript({
  matches: [
    '*://*.asaas.com/customerPayment/index*',
    '*://*.asaas.com/customerPayment/list*',
    '*://*.asaas.com/app/cobranzas*',
  ],
  runAt: 'document_idle',
  main() {
    try {
      const pageUrl = window.location.href;
      const detectedMsg: ExtensionMessage = {
        type: 'PORTAL_LIST_DETECTED',
        provider: 'asaas',
        pageUrl,
      };

      browser.runtime.sendMessage(detectedMsg).catch(() => {});

      const result = parseAsaasPayments(document);
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
