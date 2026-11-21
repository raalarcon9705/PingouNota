import { browser } from 'wxt/browser';

export const ADAFLOW_SYNC_STATE_STORAGE_KEY = 'adaflow_sync_state';

export interface AdaflowSyncState {
  isSyncing: boolean;
  progressMessage?: string;
  currentPage?: number;
  totalPages?: number;
  updatedAt: string;
}

let memorySyncStateForTesting: AdaflowSyncState | null = null;

/**
 * Recupera o estado atual de sincronização da Adaflow do storage.
 * Decoupled from Dexie / database to be completely safe for content scripts.
 */
export async function getAdaflowSyncState(): Promise<AdaflowSyncState | null> {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.get) {
      const result = await browser.storage.local.get(ADAFLOW_SYNC_STATE_STORAGE_KEY);
      const state = result?.[ADAFLOW_SYNC_STATE_STORAGE_KEY];
      if (state) return state as AdaflowSyncState;
      return null;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      return new Promise<AdaflowSyncState | null>((resolve) => {
        chrome.storage.local.get([ADAFLOW_SYNC_STATE_STORAGE_KEY], (res: Record<string, unknown>) => {
          const state = res?.[ADAFLOW_SYNC_STATE_STORAGE_KEY];
          if (state) {
            resolve(state as AdaflowSyncState);
          } else {
            resolve(null);
          }
        });
      });
    }
  } catch (error) {
    console.warn('[PingouNota:AdaflowSync] Falha ao recuperar sync state de storage.local:', error);
  }

  return memorySyncStateForTesting;
}

/**
 * Salva o estado atual de sincronização da Adaflow no storage.
 * Decoupled from Dexie / database to be completely safe for content scripts.
 */
export async function setAdaflowSyncState(state: AdaflowSyncState): Promise<void> {
  memorySyncStateForTesting = state;

  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      await browser.storage.local.set({ [ADAFLOW_SYNC_STATE_STORAGE_KEY]: state });
      return;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [ADAFLOW_SYNC_STATE_STORAGE_KEY]: state }, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      return;
    }
  } catch (error) {
    console.error('[PingouNota:AdaflowSync] Falha ao salvar sync state em storage.local:', error);
  }
}

/**
 * Helper interno para reset em testes de unidade.
 */
export function _resetSyncStateForTesting(): void {
  memorySyncStateForTesting = null;
}
