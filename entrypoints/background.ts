import { browser } from 'wxt/browser';
import { extensionMessageSchema } from '../src/shared/messages';
import { coordinatePaymentsObservation, updateActionBadge } from '../src/services/scan-coordinator';

export default defineBackground(() => {
  updateActionBadge().catch(() => {});

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      const parseResult = extensionMessageSchema.safeParse(message);
      if (!parseResult.success) {
        return false;
      }

      const validMessage = parseResult.data;

      if (validMessage.type === 'PAYMENTS_OBSERVED') {
        coordinatePaymentsObservation(validMessage.result.payments)
          .then(({ savedPayments, undeclaredCount }) => {
            sendResponse({
              success: true,
              savedCount: savedPayments.length,
              undeclaredCount,
            });
          })
          .catch((error) => {
            console.error('[PingouNota] Error processing observed payments:', error);
            sendResponse({ success: false, error: String(error) });
          });

        return true;
      }

      if (validMessage.type === 'PORTAL_LIST_DETECTED') {
        sendResponse({ acknowledged: true });
        return false;
      }

      return false;
    },
  );
});
