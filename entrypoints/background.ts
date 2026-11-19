import { browser } from 'wxt/browser';
import { extensionMessageSchema } from '../src/shared/messages';
import {
  coordinatePaymentsObservation,
  scanCoordinator,
  updateActionBadge,
} from '../src/services/scan-coordinator';

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
        scanCoordinator
          .handlePortalListDetected(validMessage.provider, validMessage.pageUrl)
          .then((result) => {
            sendResponse({ acknowledged: true, ...result });
          })
          .catch((error) => {
            console.error('[PingouNota] Error handling portal list detection:', error);
            sendResponse({ acknowledged: false, error: String(error) });
          });

        return true;
      }

      if (validMessage.type === 'SCAN_CONTROL') {
        scanCoordinator
          .handleScanControl(validMessage.action, validMessage.provider, validMessage.scanId)
          .then((result) => {
            sendResponse({ success: true, ...result });
          })
          .catch((error) => {
            console.error('[PingouNota] Error handling scan control:', error);
            sendResponse({ success: false, error: String(error) });
          });

        return true;
      }

      return false;
    },
  );
});
