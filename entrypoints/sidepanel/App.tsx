import React, { useCallback, useEffect, useState } from 'react';
import type { Payment } from '../../src/domain/payment';
import type { ScanProgress } from '../../src/shared/messages';
import { scanCoordinator, type ScanStatus } from '../../src/services/scan-coordinator';
import { listPayments } from '../../src/storage/payment-repository';
import PaymentsScreen, { type PortalSourceState } from './screens/PaymentsScreen';
import { browser } from 'wxt/browser';

export function isSupportedPortalUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    return (
      host === 'asaas.com' ||
      host.endsWith('.asaas.com') ||
      host === 'husky.io' ||
      host.endsWith('.husky.io') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

export const App: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sourceState, setSourceState] = useState<PortalSourceState>('supported');
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanReason, setScanReason] = useState<string | null>(null);
  const [scanPages, setScanPages] = useState<number>(0);
  const [scanRecords, setScanRecords] = useState<number>(0);

  const checkActiveTab = useCallback(async () => {
    try {
      if (browser?.tabs?.query) {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs[0]?.url;
        if (currentUrl) {
          if (!isSupportedPortalUrl(currentUrl)) {
            setSourceState('unsupported-origin');
          } else {
            setSourceState('supported');
          }
        }
      }
    } catch (error) {
      console.warn('[PingouNota] Falha ao verificar aba ativa:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const items = await listPayments();
      setPayments(items);

      // Check scan metadata for any active warnings
      const [asaasMeta, huskyMeta] = await Promise.all([
        scanCoordinator.getScanMetadata('asaas'),
        scanCoordinator.getScanMetadata('husky'),
      ]);

      const activeWarningMeta = [asaasMeta, huskyMeta].find(
        (meta) =>
          meta &&
          (meta.status === 'partial' || meta.status === 'paused' || meta.status === 'failed'),
      );

      if (activeWarningMeta) {
        setScanStatus(activeWarningMeta.status);
        setScanReason(activeWarningMeta.reason);
        setScanPages(activeWarningMeta.pagesSeen);
        setScanRecords(activeWarningMeta.recordsFound);

        if (activeWarningMeta.status === 'failed') {
          setSourceState('source-unavailable');
          setSourceMessage(
            activeWarningMeta.reason ||
              'Não foi possível conectar ao portal de pagamentos. Verifique se você está autenticado.',
          );
        }
      }
    } catch (error) {
      console.error('[PingouNota] Erro ao carregar pagamentos:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    checkActiveTab();

    // Listen for tab changes to detect if user switches outside supported portal
    try {
      const tabs = browser?.tabs;
      if (tabs?.onActivated) {
        const onActivated = () => {
          checkActiveTab();
        };
        tabs.onActivated.addListener(onActivated);
      }
      if (tabs?.onUpdated) {
        const onUpdated = (_tabId: number, changeInfo: { url?: string }) => {
          if (changeInfo.url) {
            checkActiveTab();
          }
        };
        tabs.onUpdated.addListener(onUpdated);
      }
    } catch {
      // Ignore in non-extension environment
    }

    // Listen for extension messages to live-update the side panel
    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const msg = message as { type?: string; progress?: ScanProgress };

      if (msg.type === 'PAYMENTS_OBSERVED') {
        loadData();
      }

      if (msg.type === 'SCAN_PROGRESS' && msg.progress) {
        setScanStatus(msg.progress.status);
        setScanReason(msg.progress.reason || null);
        setScanPages(msg.progress.pagesSeen);
        setScanRecords(msg.progress.recordsFound);

        if (msg.progress.status === 'failed') {
          setSourceState('source-unavailable');
          setSourceMessage(
            msg.progress.reason ||
              'Não foi possível conectar ao portal de pagamentos. Verifique se você está autenticado.',
          );
        } else if (msg.progress.status === 'complete') {
          loadData();
        }
      }
    };

    try {
      if (browser?.runtime?.onMessage) {
        browser.runtime.onMessage.addListener(handleMessage);
        return () => {
          browser.runtime.onMessage.removeListener(handleMessage);
        };
      }
    } catch {
      // Ignore in non-extension environments (e.g. tests)
    }
  }, [loadData, checkActiveTab]);

  const handleLocalMark = (selected: Payment[]) => {
    // Placeholder for Task 7: Local declaration marking
    console.log('[PingouNota] Solicitação de marcação local para', selected.length, 'itens');
  };

  const handleIssueAdaflow = (selected: Payment[]) => {
    // Placeholder for Task 9: Adaflow NFSe issue
    console.log('[PingouNota] Solicitação de emissão Adaflow para', selected.length, 'itens');
  };

  return (
    <main className="panel" role="main">
      <header className="panel-header">
        <img src="/icons/icon-48.png" width="40" height="40" alt="Logo PingouNota" />
        <div>
          <h1>PingouNota</h1>
          <p>Pagamentos e declarações em um só lugar.</p>
        </div>
      </header>

      <PaymentsScreen
        payments={payments}
        isLoading={isLoading}
        sourceState={sourceState}
        sourceStateMessage={sourceMessage}
        scanStatus={scanStatus}
        scanReason={scanReason}
        pagesSeen={scanPages}
        recordsFound={scanRecords}
        onLocalMark={handleLocalMark}
        onIssueAdaflow={handleIssueAdaflow}
        onRefresh={loadData}
      />
    </main>
  );
};

export default App;
