import { browser } from 'wxt/browser';
import { fetchAdaflowDeclarations } from '../src/services/adaflow-scraper';
import type { ExtensionMessage } from '../src/shared/messages';

declare global {
  interface Window {
    __pingounota_adaflow_reconciling?: boolean;
    __pingounota_adaflow_last_reconciled?: number;
  }
}

const RECONCILIATION_COOLDOWN_MS = 60_000;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let removeTimer: ReturnType<typeof setTimeout> | null = null;

export default defineContentScript({
  matches: ['https://app.adaflow.com/*'],
  runAt: 'document_idle',
  async main() {
    const runReconciliation = async () => {
      if (!window.location.pathname.startsWith('/nfses')) {
        return;
      }

      if (window.__pingounota_adaflow_reconciling) {
        return;
      }

      const now = Date.now();
      const lastReconciled = window.__pingounota_adaflow_last_reconciled ?? 0;
      if (now - lastReconciled < RECONCILIATION_COOLDOWN_MS) {
        return;
      }

      window.__pingounota_adaflow_reconciling = true;
      window.__pingounota_adaflow_last_reconciled = now;

      let pill: HTMLDivElement | null = null;
      try {
        pill = createOrUpdatePill('PingouNota: Sincronizando notas fiscais emitidas...');

        const declarations = await fetchAdaflowDeclarations();

        if (declarations.length > 0) {
          const message: ExtensionMessage = {
            type: 'ADAFLOW_RECONCILIATION_OBSERVED',
            declarations,
          };

          const response = (await browser.runtime.sendMessage(message)) as {
            success?: boolean;
            matchedCount?: number;
            updatedCount?: number;
          } | null;

          const count = response?.matchedCount ?? 0;
          if (count > 0) {
            createOrUpdatePill(`PingouNota: ${count} notas conciliadas com sucesso!`, 5000);
          } else {
            createOrUpdatePill('PingouNota: Nenhuma nota correspondente no Asaas.', 5000);
          }
        } else {
          createOrUpdatePill('PingouNota: Nenhuma nota correspondente no Asaas.', 5000);
        }
      } catch (err) {
        console.error('[PingouNota] Erro durante auto-conciliação Adaflow:', err);
        if (pill) {
          createOrUpdatePill('PingouNota: Erro ao sincronizar notas.', 5000);
        }
      } finally {
        window.__pingounota_adaflow_reconciling = false;
      }
    };

    runReconciliation().catch(() => {});

    // Adaflow is a Rails Turbo application; listen for turbo:load navigations
    document.addEventListener('turbo:load', () => {
      runReconciliation().catch(() => {});
    });
  },
});

function createOrUpdatePill(text: string, autoDismissMs = 0): HTMLDivElement {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (removeTimer) {
    clearTimeout(removeTimer);
    removeTimer = null;
  }

  let pill = document.getElementById('pingounota-reconciliation-pill') as HTMLDivElement | null;
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'pingounota-reconciliation-pill';
    pill.style.position = 'fixed';
    pill.style.top = '16px';
    pill.style.right = '24px';
    pill.style.zIndex = '999999';
    pill.style.backgroundColor = '#0f172a';
    pill.style.color = '#f8fafc';
    pill.style.fontSize = '13px';
    pill.style.fontWeight = '500';
    pill.style.padding = '8px 16px';
    pill.style.borderRadius = '9999px';
    pill.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.16)';
    pill.style.fontFamily =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    pill.style.pointerEvents = 'none';
    pill.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    pill.style.transform = 'translateY(0)';
    pill.style.opacity = '1';

    const target = document.body || document.documentElement;
    target.appendChild(pill);
  }

  pill.textContent = text;
  pill.style.opacity = '1';
  pill.style.transform = 'translateY(0)';

  if (autoDismissMs > 0) {
    dismissTimer = setTimeout(() => {
      if (pill) {
        pill.style.opacity = '0';
        pill.style.transform = 'translateY(-6px)';
        removeTimer = setTimeout(() => {
          pill?.remove();
          dismissTimer = null;
          removeTimer = null;
        }, 300);
      }
    }, autoDismissMs);
  }

  return pill;
}
