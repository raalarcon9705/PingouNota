import { browser } from 'wxt/browser';
import { asaasAdapter, fetchAsaasPayments } from '../src/services/adapters';
import type { ExtensionMessage } from '../src/shared/messages';
import type { ParseResult } from '../src/shared/observed-payment';

export default defineContentScript({
  matches: [
    '*://*.asaas.com/customerPayment/index*',
    '*://*.asaas.com/customerPayment/list*',
    '*://*.asaas.com/app/cobranzas*',
    '*://*.asaas.com/payment/list*',
    '*://*.asaas.com/payment/index*',
    '*://*.asaas.com/payment',
    '*://*.asaas.com/payment?*',
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

      let result: ParseResult;
      let usedFetch = false;

      try {
        // Primary: authenticated fetch requesting all pages
        result = await fetchAsaasPayments(1, 50);
        usedFetch = true;
      } catch (fetchErr) {
        // Fallback: DOM scanning
        console.warn?.('[PingouNota] Authenticated fetch failed, falling back to DOM parsing:', fetchErr);
        result = asaasAdapter.parse(document);
        const allPayments = result.payments;
        console.info(
          `[PingouNota:Asaas] 🔍 Escaneando cobranças... Página 1: ${allPayments.length} encontradas (Total acumulado: ${allPayments.length} de ${allPayments.length})`,
        );
        console.groupCollapsed(`[PingouNota:Asaas] 📋 Cobranças sincronizadas (${allPayments.length} pagamentos)`);
        console.table(
          allPayments.map((p) => ({
            ID: p.sourcePaymentId,
            Pagador: p.payerName,
            Valor: (p.amountCents || 0) / 100,
            Estado: p.paymentState,
            Status: p.sourceStatus,
          })),
        );
        console.groupEnd();
      }

      const observedMsg: ExtensionMessage = {
        type: 'PAYMENTS_OBSERVED',
        scanId,
        pageUrl,
        result,
      };

      await browser.runtime.sendMessage(observedMsg).catch(() => {});

      // When fetch is used, all pages are collected in-memory (pagination is 'end').
      // Only execute window.location.href if fallback DOM scanning was used and returned an actual HTML page nextHref.
      if (!usedFetch) {
        const pagination = asaasAdapter.nextPage(document);
        if (pagination.kind === 'next' && !userInteracted) {
          const nextHref = pagination.href;
          if (asaasAdapter.isSupportedRoute(nextHref)) {
            window.location.href = nextHref;
          }
        }
      }
    } catch (err) {
      console.error('[PingouNota] Asaas content script error:', err);
    }
  },
});
