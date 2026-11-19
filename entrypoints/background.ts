import { browser } from 'wxt/browser';
import { extensionMessageSchema } from '../src/shared/messages';
import {
  coordinatePaymentsObservation,
  scanCoordinator,
  updateActionBadge,
} from '../src/services/scan-coordinator';

export default defineBackground(() => {
  const setupStorageSecurity = async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local?.setAccessLevel) {
        await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      }
    } catch (error) {
      console.warn('[PingouNota] Storage security configuration unavailable:', error);
    }
  };

  const setupSidePanel = async () => {
    try {
      const sidePanel = (browser as unknown as {
        sidePanel?: {
          setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
        };
      }).sidePanel;

      if (sidePanel?.setPanelBehavior) {
        await sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    } catch (error) {
      console.warn('[PingouNota] Side panel behavior configuration unavailable:', error);
    }
  };

  setupStorageSecurity().catch(() => {});
  setupSidePanel().catch(() => {});

  if (browser?.runtime?.onInstalled) {
    browser.runtime.onInstalled.addListener(() => {
      setupStorageSecurity().catch(() => {});
      setupSidePanel().catch(() => {});
    });
  }

  if (browser?.runtime?.onStartup) {
    browser.runtime.onStartup.addListener(() => {
      setupStorageSecurity().catch(() => {});
      setupSidePanel().catch(() => {});
    });
  }

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
          .then(async (result) => {
            const undeclaredCount = await updateActionBadge();
            sendResponse({ acknowledged: true, undeclaredCount, ...result });
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
