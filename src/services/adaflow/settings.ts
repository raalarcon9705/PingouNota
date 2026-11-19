import { browser } from 'wxt/browser';

export const ADAFLOW_TOKEN_STORAGE_KEY = 'adaflow_api_token';

let memoryTokenForTesting: string | null = null;

/**
 * Recupera o token de API da Adaflow salvo localmente no storage.
 */
export async function getAdaflowToken(): Promise<string | null> {
  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.get) {
      const result = await browser.storage.local.get(ADAFLOW_TOKEN_STORAGE_KEY);
      const token = result?.[ADAFLOW_TOKEN_STORAGE_KEY];
      if (typeof token === 'string' && token.trim().length > 0) {
        return token.trim();
      }
      return null;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      return new Promise<string | null>((resolve) => {
        chrome.storage.local.get([ADAFLOW_TOKEN_STORAGE_KEY], (res: Record<string, unknown>) => {
          const token = res?.[ADAFLOW_TOKEN_STORAGE_KEY];
          if (typeof token === 'string' && token.trim().length > 0) {
            resolve(token.trim());
          } else {
            resolve(null);
          }
        });
      });
    }
  } catch (error) {
    console.warn('[PingouNota] Falha ao recuperar token da Adaflow de storage.local:', error);
  }

  return memoryTokenForTesting;
}

/**
 * Salva o token de API da Adaflow localmente no storage.
 */
export async function saveAdaflowToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Token de API da Adaflow não pode ser vazio');
  }

  memoryTokenForTesting = trimmed;

  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.set) {
      await browser.storage.local.set({ [ADAFLOW_TOKEN_STORAGE_KEY]: trimmed });
      return;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [ADAFLOW_TOKEN_STORAGE_KEY]: trimmed }, () => {
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
    console.error('[PingouNota] Falha ao salvar token da Adaflow em storage.local:', error);
    throw error;
  }
}

/**
 * Remove o token de API da Adaflow do storage.
 */
export async function removeAdaflowToken(): Promise<void> {
  memoryTokenForTesting = null;

  try {
    if (typeof browser !== 'undefined' && browser?.storage?.local?.remove) {
      await browser.storage.local.remove(ADAFLOW_TOKEN_STORAGE_KEY);
      return;
    }

    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.remove) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.remove([ADAFLOW_TOKEN_STORAGE_KEY], () => {
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
    console.error('[PingouNota] Falha ao remover token da Adaflow de storage.local:', error);
    throw error;
  }
}

/**
 * Retorna true se houver um token configurado.
 */
export async function hasAdaflowToken(): Promise<boolean> {
  const token = await getAdaflowToken();
  return Boolean(token && token.length > 0);
}

/**
 * Helper interno para reset em testes de unidade.
 */
export function _resetMemoryTokenForTesting(): void {
  memoryTokenForTesting = null;
}
