import React, { useCallback, useEffect, useState } from 'react';
import type { Payment } from '../../src/domain/payment';
import type { ScanProgress } from '../../src/shared/messages';
import { scanCoordinator, type ScanStatus } from '../../src/services/scan-coordinator';
import { listPayments } from '../../src/storage/payment-repository';
import PaymentsScreen, { type PortalSourceState } from './screens/PaymentsScreen';
import TemplatesScreen from './screens/TemplatesScreen';
import TakersScreen from './screens/TakersScreen';
import LocalMarkDialog from './components/LocalMarkDialog';
import { browser } from 'wxt/browser';

export type TabKey = 'pagamentos' | 'modelos' | 'tomadores' | 'configuracoes';

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
  const [activeTab, setActiveTab] = useState<TabKey>('pagamentos');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sourceState, setSourceState] = useState<PortalSourceState>('supported');
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanReason, setScanReason] = useState<string | null>(null);
  const [scanPages, setScanPages] = useState<number>(0);
  const [scanRecords, setScanRecords] = useState<number>(0);

  // Local Mark confirmation dialog state
  const [selectedForLocalMark, setSelectedForLocalMark] = useState<
    Payment[] | null
  >(null);

  const checkActiveTab = useCallback(async () => {
    try {
      if (browser?.tabs?.query) {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (activeTab) {
          if (!activeTab.url) {
            // In Chrome MV3, tab.url is undefined on sites outside host_permissions.
            // Since Asaas and Husky are in host_permissions, undefined url indicates an unsupported origin.
            setSourceState('unsupported-origin');
          } else if (!isSupportedPortalUrl(activeTab.url)) {
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

    const onActivated = () => {
      checkActiveTab();
    };

    const onUpdated = (_tabId: number, changeInfo: { url?: string }) => {
      if (changeInfo.url) {
        checkActiveTab();
      }
    };

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
      browser?.tabs?.onActivated?.addListener?.(onActivated);
      browser?.tabs?.onUpdated?.addListener?.(onUpdated);
      browser?.runtime?.onMessage?.addListener?.(handleMessage);
    } catch {
      // Ignore in non-extension environments (e.g. tests)
    }

    return () => {
      try {
        browser?.tabs?.onActivated?.removeListener?.(onActivated);
        browser?.tabs?.onUpdated?.removeListener?.(onUpdated);
        browser?.runtime?.onMessage?.removeListener?.(handleMessage);
      } catch {
        // Ignore errors during cleanup
      }
    };
  }, [loadData, checkActiveTab]);

  const handleLocalMark = (selected: Payment[]) => {
    setSelectedForLocalMark(selected);
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

      {/* Tab Navigation */}
      <nav className="tab-navigation" role="tablist" aria-label="Navegação principal">
        <button
          type="button"
          role="tab"
          className={`tab-btn ${activeTab === 'pagamentos' ? 'tab-active' : ''}`}
          aria-selected={activeTab === 'pagamentos'}
          aria-controls="tabpanel-pagamentos"
          id="tab-pagamentos"
          onClick={() => setActiveTab('pagamentos')}
        >
          Pagamentos
        </button>
        <button
          type="button"
          role="tab"
          className={`tab-btn ${activeTab === 'modelos' ? 'tab-active' : ''}`}
          aria-selected={activeTab === 'modelos'}
          aria-controls="tabpanel-modelos"
          id="tab-modelos"
          onClick={() => setActiveTab('modelos')}
        >
          Modelos
        </button>
        <button
          type="button"
          role="tab"
          className={`tab-btn ${activeTab === 'tomadores' ? 'tab-active' : ''}`}
          aria-selected={activeTab === 'tomadores'}
          aria-controls="tabpanel-tomadores"
          id="tab-tomadores"
          onClick={() => setActiveTab('tomadores')}
        >
          Tomadores
        </button>
        <button
          type="button"
          role="tab"
          className={`tab-btn ${activeTab === 'configuracoes' ? 'tab-active' : ''}`}
          aria-selected={activeTab === 'configuracoes'}
          aria-controls="tabpanel-configuracoes"
          id="tab-configuracoes"
          onClick={() => setActiveTab('configuracoes')}
        >
          Configurações
        </button>
      </nav>

      {/* Tab Panels */}
      <div className="tab-content">
        {activeTab === 'pagamentos' && (
          <div
            role="tabpanel"
            id="tabpanel-pagamentos"
            aria-labelledby="tab-pagamentos"
          >
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
          </div>
        )}

        {activeTab === 'modelos' && (
          <div
            role="tabpanel"
            id="tabpanel-modelos"
            aria-labelledby="tab-modelos"
          >
            <TemplatesScreen />
          </div>
        )}

        {activeTab === 'tomadores' && (
          <div
            role="tabpanel"
            id="tabpanel-tomadores"
            aria-labelledby="tab-tomadores"
          >
            <TakersScreen />
          </div>
        )}

        {activeTab === 'configuracoes' && (
          <div
            role="tabpanel"
            id="tabpanel-configuracoes"
            aria-labelledby="tab-configuracoes"
            className="subscreen-container"
          >
            <header className="subscreen-header">
              <div>
                <h2>Configurações</h2>
                <p className="subscreen-subtitle">
                  Preferências gerais e integração com a Adaflow.
                </p>
              </div>
            </header>
            <div className="settings-section">
              <div className="settings-card">
                <h3>Integração Adaflow</h3>
                <p>
                  As credenciais e configurações de emissão direta são gerenciadas
                  localmente e armazenadas de forma segura nesta extensão.
                </p>
              </div>
              <div className="settings-card">
                <h3>Armazenamento Local</h3>
                <p>
                  Todos os dados de pagamentos, modelos e tomadores são salvos no
                  banco de dados Dexie IndexedDB do seu navegador.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Local Mark Dialog */}
      {selectedForLocalMark && (
        <LocalMarkDialog
          isOpen={Boolean(selectedForLocalMark)}
          payments={selectedForLocalMark}
          onClose={() => setSelectedForLocalMark(null)}
          onSuccess={async () => {
            await loadData();
          }}
        />
      )}
    </main>
  );
};

export default App;
