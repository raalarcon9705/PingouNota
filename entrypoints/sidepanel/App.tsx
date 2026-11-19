import React, { useCallback, useEffect, useState } from 'react';
import type { Payment } from '../../src/domain/payment';
import type { ScanProgress } from '../../src/shared/messages';
import { scanCoordinator, type ScanStatus } from '../../src/services/scan-coordinator';
import { listPayments } from '../../src/storage/payment-repository';
import PaymentsScreen from './screens/PaymentsScreen';
import { browser } from 'wxt/browser';

export const App: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanReason, setScanReason] = useState<string | null>(null);
  const [scanPages, setScanPages] = useState<number>(0);
  const [scanRecords, setScanRecords] = useState<number>(0);

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
        (meta) => meta && (meta.status === 'partial' || meta.status === 'paused' || meta.status === 'failed'),
      );

      if (activeWarningMeta) {
        setScanStatus(activeWarningMeta.status);
        setScanReason(activeWarningMeta.reason);
        setScanPages(activeWarningMeta.pagesSeen);
        setScanRecords(activeWarningMeta.recordsFound);
      }
    } catch (error) {
      console.error('[PingouNota] Erro ao carregar pagamentos:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

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

        if (msg.progress.status === 'complete') {
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
  }, [loadData]);

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
