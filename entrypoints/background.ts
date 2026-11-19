import { browser } from 'wxt/browser';
import { extensionMessageSchema } from '../src/shared/messages';
import {
  coordinatePaymentsObservation,
  scanCoordinator,
  updateActionBadge,
} from '../src/services/scan-coordinator';
import { emissionQueue } from '../src/services/adaflow/emission-queue';

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

  const setupQueueAlarms = async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.alarms?.create) {
        chrome.alarms.create('ADAFLOW_POLL_ALARM', { periodInMinutes: 1 });
      } else if (typeof browser !== 'undefined' && browser?.alarms?.create) {
        await browser.alarms.create('ADAFLOW_POLL_ALARM', { periodInMinutes: 1 });
      }
    } catch (error) {
      console.warn('[PingouNota] Failed to setup poll alarm:', error);
    }
  };

  const handleAlarm = async (alarm: { name: string }) => {
    if (alarm.name === 'ADAFLOW_POLL_ALARM') {
      try {
        await emissionQueue.pollOperations();
        await emissionQueue.processQueue();
      } catch (err) {
        console.warn('[PingouNota] Error during alarm queue handling:', err);
      }
    }
  };

  try {
    if (typeof chrome !== 'undefined' && chrome?.alarms?.onAlarm) {
      chrome.alarms.onAlarm.addListener(handleAlarm);
    } else if (typeof browser !== 'undefined' && browser?.alarms?.onAlarm) {
      browser.alarms.onAlarm.addListener(handleAlarm);
    }
  } catch {
    // Non-extension or mock environment
  }

  setupStorageSecurity().catch(() => {});
  setupSidePanel().catch(() => {});
  setupQueueAlarms().catch(() => {});

  if (browser?.runtime?.onInstalled) {
    browser.runtime.onInstalled.addListener(() => {
      setupStorageSecurity().catch(() => {});
      setupSidePanel().catch(() => {});
      setupQueueAlarms().catch(() => {});
      emissionQueue.pollOperations().catch(() => {});
      emissionQueue.processQueue().catch(() => {});
    });
  }

  if (browser?.runtime?.onStartup) {
    browser.runtime.onStartup.addListener(() => {
      setupStorageSecurity().catch(() => {});
      setupSidePanel().catch(() => {});
      setupQueueAlarms().catch(() => {});
      emissionQueue.pollOperations().catch(() => {});
      emissionQueue.processQueue().catch(() => {});
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

      if (validMessage.type === 'ISSUE_QUEUE_START') {
        emissionQueue
          .processQueue(validMessage.operationIds)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            console.error('[PingouNota] Error processing issue queue:', error);
            sendResponse({ success: false, error: String(error) });
          });

        return true;
      }

      return false;
    },
  );
});
