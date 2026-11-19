import type { NfseIssuePayload } from '../../domain/nfse-operation';
import {
  AdaflowAuthError,
  AdaflowError,
  AdaflowNotFoundError,
  AdaflowRateLimitError,
  AdaflowServerError,
  AdaflowTimeoutError,
  AdaflowValidationError,
} from './errors';

export interface AdaflowClientConfig {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface AdaflowNfseItem {
  id: number;
  status: string;
  external_id?: string | null;
  number?: string | null;
  verification_code?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
  error_message?: string | null;
  errors?: unknown;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface AdaflowNfseResponse {
  id: number;
  status: string;
  external_id?: string | null;
  number?: string | null;
  verification_code?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
  error_message?: string | null;
  errors?: unknown;
  created_at?: string;
  updated_at?: string;
  nfse?: AdaflowNfseItem | Record<string, unknown>;
  [key: string]: unknown;
}

export class AdaflowClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: AdaflowClientConfig) {
    if (!config || typeof config.token !== 'string' || !config.token.trim()) {
      throw new Error('Adaflow API token é obrigatório');
    }
    this.token = config.token.trim();
    this.baseUrl = (config.baseUrl || 'https://app.adaflow.com/api/v1').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  /**
   * Envia requisição POST /nfses para emissão de NFSe na Adaflow.
   */
  public async createNfse(
    payload: NfseIssuePayload,
    idempotencyKey: string,
  ): Promise<AdaflowNfseResponse> {
    if (!idempotencyKey || !idempotencyKey.trim()) {
      throw new Error('Chave de idempotência (idempotencyKey) é obrigatória');
    }

    const url = `${this.baseUrl}/nfses`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey.trim(),
    };

    const body = JSON.stringify({ nfse: payload });

    return this.request<AdaflowNfseResponse>(url, {
      method: 'POST',
      headers,
      body,
    });
  }

  /**
   * Consulta uma NFSe por ID na Adaflow: GET /nfses/:id
   */
  public async getNfse(id: number | string): Promise<AdaflowNfseResponse> {
    if (id === undefined || id === null || String(id).trim() === '') {
      throw new Error('ID da NFSe é obrigatório');
    }

    const encodedId = encodeURIComponent(String(id).trim());
    const url = `${this.baseUrl}/nfses/${encodedId}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    return this.request<AdaflowNfseResponse>(url, {
      method: 'GET',
      headers,
    });
  }

  /**
   * Consulta uma NFSe pelo external_id: GET /nfses/by-external-id/:external_id
   */
  public async getNfseByExternalId(externalId: string): Promise<AdaflowNfseResponse> {
    if (!externalId || !externalId.trim()) {
      throw new Error('external_id da NFSe é obrigatório');
    }

    const encodedExternalId = encodeURIComponent(externalId.trim());
    const url = `${this.baseUrl}/nfses/by-external-id/${encodedExternalId}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    return this.request<AdaflowNfseResponse>(url, {
      method: 'GET',
      headers,
    });
  }

  /**
   * Executa requisição HTTP com timeout e mapeamento padronizado de erros.
   */
  private async request<T extends AdaflowNfseResponse>(
    url: string,
    init: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    let isTimedOut = false;

    const timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });

      return await this.handleResponse<T>(response);
    } catch (error: unknown) {
      if (isTimedOut || (error instanceof Error && error.name === 'AbortError')) {
        throw new AdaflowTimeoutError(
          `Tempo limite de ${this.timeoutMs}ms esgotado ao comunicar com a Adaflow.`,
        );
      }

      if (error instanceof AdaflowError) {
        throw error;
      }

      throw new AdaflowServerError(
        `Erro ao comunicar com o servidor da Adaflow: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Processa status HTTP e corpo retornado pela API da Adaflow.
   */
  private async handleResponse<T extends AdaflowNfseResponse>(
    response: Response,
  ): Promise<T> {
    const rawText = await response.text();
    let data: Record<string, unknown> | null = null;

    if (rawText && rawText.trim().length > 0) {
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch (parseError) {
        if (response.status >= 500) {
          throw new AdaflowServerError(
            `Servidor Adaflow retornou erro ${response.status} com corpo inválido (JSON malformado).`,
            response.status,
            rawText,
          );
        }
        throw new AdaflowError(
          `Resposta inválida da Adaflow (JSON malformado, status HTTP ${response.status}).`,
          response.status,
          rawText,
        );
      }
    }

    if (!response.ok) {
      this.handleErrorResponse(response, data);
    }

    if (!data) {
      throw new AdaflowServerError(
        'Resposta vazia e inesperada da Adaflow com status HTTP ' + response.status,
        response.status,
      );
    }

    // Normaliza resposta se estiver envolvida em { nfse: { ... } }
    if (data.nfse && typeof data.nfse === 'object') {
      const nested = data.nfse as Record<string, unknown>;
      return {
        ...nested,
        ...data,
        id: (nested.id as number) ?? (data.id as number),
        status: (nested.status as string) ?? (data.status as string),
      } as T;
    }

    return data as T;
  }

  /**
   * Mapeia códigos de status de erro (401, 404, 422, 429, 500+) para classes tipadas.
   */
  private handleErrorResponse(
    response: Response,
    data: Record<string, unknown> | null,
  ): never {
    const message =
      data && (typeof data.message === 'string' || typeof data.error === 'string')
        ? String(data.message || data.error)
        : undefined;

    switch (response.status) {
      case 401:
        throw new AdaflowAuthError(
          message || 'Token de API da Adaflow inválido, ausente ou expirado.',
          data,
        );

      case 404:
        throw new AdaflowNotFoundError(
          message || 'Recurso não encontrado na Adaflow.',
          data,
        );

      case 422: {
        const errors = data?.errors ?? data;
        throw new AdaflowValidationError(
          message || 'Erro de validação dos dados da NFSe na Adaflow.',
          errors,
          data,
        );
      }

      case 429: {
        const retryHeader =
          response.headers?.get('retry-after') || response.headers?.get('Retry-After');
        let retryAfter: number | undefined;

        if (retryHeader) {
          const parsedSeconds = parseInt(retryHeader, 10);
          if (!isNaN(parsedSeconds)) {
            retryAfter = parsedSeconds;
          } else {
            const parsedDate = Date.parse(retryHeader);
            if (!isNaN(parsedDate)) {
              retryAfter = Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));
            }
          }
        }

        throw new AdaflowRateLimitError(
          message || 'Limite de requisições excedido na Adaflow (Rate Limit).',
          retryAfter,
          data,
        );
      }

      default:
        if (response.status >= 500) {
          throw new AdaflowServerError(
            message || `Erro interno no servidor da Adaflow (status ${response.status}).`,
            response.status,
            data,
          );
        }

        throw new AdaflowError(
          message || `Falha na requisição à Adaflow (status ${response.status}).`,
          response.status,
          data,
        );
    }
  }
}
