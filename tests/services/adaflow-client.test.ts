import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaflowClient } from '../../src/services/adaflow/client';
import {
  AdaflowAuthError,
  AdaflowError,
  AdaflowNotFoundError,
  AdaflowRateLimitError,
  AdaflowServerError,
  AdaflowTimeoutError,
  AdaflowValidationError,
} from '../../src/services/adaflow/errors';
import type { NfseIssuePayload } from '../../src/domain/nfse-operation';
import {
  getAdaflowToken,
  saveAdaflowToken,
  removeAdaflowToken,
  hasAdaflowToken,
  _resetMemoryTokenForTesting,
} from '../../src/services/adaflow/settings';

describe('AdaflowClient', () => {
  const samplePayload: NfseIssuePayload = {
    cnae: '6201501',
    description: 'Serviços de desenvolvimento de software',
    value_cents: 250000,
    withhold_taxes: false,
    external_id: 'asaas_pay_123_op_001',
    service_taker: {
      name: 'Cliente Tomador S.A.',
      document: '12345678000195',
      email: 'financeiro@cliente.com',
    },
  };

  const createMockResponse = (
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ): Response => {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const headerMap = new Map<string, string>(
      Object.entries({
        'content-type': 'application/json',
        ...headers,
      }),
    );

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : status === 202 ? 'Accepted' : 'Error',
      headers: {
        get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      } as unknown as Headers,
      text: async () => rawBody,
      json: async () => (rawBody ? JSON.parse(rawBody) : null),
    } as unknown as Response;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetMemoryTokenForTesting();
  });

  describe('Client Initialization', () => {
    it('throws error if token is missing or empty', () => {
      expect(() => new AdaflowClient({ token: '' })).toThrow(
        'Adaflow API token é obrigatório',
      );
      expect(() => new AdaflowClient({ token: '   ' })).toThrow(
        'Adaflow API token é obrigatório',
      );
      // @ts-expect-error Testing invalid runtime input
      expect(() => new AdaflowClient({})).toThrow('Adaflow API token é obrigatório');
    });

    it('initializes with default base URL', () => {
      const client = new AdaflowClient({ token: 'test-token' });
      expect(client).toBeInstanceOf(AdaflowClient);
    });

    it('strips trailing slashes from custom baseUrl', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({ id: 99, status: 'issued' }),
      );
      const client = new AdaflowClient({
        token: 'test-token',
        baseUrl: 'https://custom.adaflow.test/api/v1///',
        fetchFn: mockFetch,
      });

      await client.getNfse(99);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.adaflow.test/api/v1/nfses/99',
        expect.anything(),
      );
    });
  });

  describe('createNfse (POST /nfses)', () => {
    it('sends POST /nfses with Authorization, Idempotency-Key, and wrapped JSON body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          {
            id: 101,
            status: 'requested',
            external_id: 'asaas_pay_123_op_001',
          },
          202,
        ),
      );

      const client = new AdaflowClient({
        token: 'secret-token-123',
        fetchFn: mockFetch,
      });

      const response = await client.createNfse(samplePayload, 'idem-key-abc');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0]!;

      expect(calledUrl).toBe('https://app.adaflow.com/api/v1/nfses');
      expect(calledInit.method).toBe('POST');
      expect(calledInit.headers).toEqual({
        Authorization: 'Bearer secret-token-123',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-key-abc',
      });

      const parsedSentBody = JSON.parse(calledInit.body);
      expect(parsedSentBody).toEqual({ nfse: samplePayload });

      expect(response.id).toBe(101);
      expect(response.status).toBe('requested');
      expect(response.external_id).toBe('asaas_pay_123_op_001');
    });

    it('handles nested { nfse: { id, status } } response format seamlessly', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          {
            nfse: {
              id: 202,
              status: 'requested',
              external_id: 'nested-external-id',
            },
          },
          202,
        ),
      );

      const client = new AdaflowClient({
        token: 'secret-token',
        fetchFn: mockFetch,
      });

      const response = await client.createNfse(samplePayload, 'idem-456');

      expect(response.id).toBe(202);
      expect(response.status).toBe('requested');
      expect(response.external_id).toBe('nested-external-id');
    });

    it('rejects empty idempotency key', async () => {
      const client = new AdaflowClient({ token: 'test-token' });
      await expect(client.createNfse(samplePayload, '')).rejects.toThrow(
        'Chave de idempotência (idempotencyKey) é obrigatória',
      );
      await expect(client.createNfse(samplePayload, '   ')).rejects.toThrow(
        'Chave de idempotência (idempotencyKey) é obrigatória',
      );
    });
  });

  describe('getNfse (GET /nfses/:id)', () => {
    it('sends GET /nfses/:id with Authorization header and path encodes the ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({
          id: 555,
          status: 'issued',
          number: '2026001',
          pdf_url: 'https://adaflow.com/pdf/555',
        }),
      );

      const client = new AdaflowClient({
        token: 'auth-token-xyz',
        fetchFn: mockFetch,
      });

      const response = await client.getNfse('abc/def#1');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0]!;

      expect(calledUrl).toBe(
        'https://app.adaflow.com/api/v1/nfses/' + encodeURIComponent('abc/def#1'),
      );
      expect(calledInit.method).toBe('GET');
      expect(calledInit.headers).toEqual({
        Authorization: 'Bearer auth-token-xyz',
      });

      expect(response.id).toBe(555);
      expect(response.status).toBe('issued');
      expect(response.number).toBe('2026001');
      expect(response.pdf_url).toBe('https://adaflow.com/pdf/555');
    });

    it('throws error if ID is empty', async () => {
      const client = new AdaflowClient({ token: 'test-token' });
      await expect(client.getNfse('')).rejects.toThrow('ID da NFSe é obrigatório');
    });
  });

  describe('getNfseByExternalId (GET /nfses/by-external-id/:external_id)', () => {
    it('sends GET /nfses/by-external-id/:external_id with Authorization header and encodes externalId', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({
          id: 777,
          status: 'issued',
          external_id: 'asaas/pay/001',
        }),
      );

      const client = new AdaflowClient({
        token: 'token-ext',
        fetchFn: mockFetch,
      });

      const response = await client.getNfseByExternalId('asaas/pay/001');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0]!;

      expect(calledUrl).toBe(
        'https://app.adaflow.com/api/v1/nfses/by-external-id/' +
          encodeURIComponent('asaas/pay/001'),
      );
      expect(calledInit.method).toBe('GET');
      expect(calledInit.headers).toEqual({
        Authorization: 'Bearer token-ext',
      });
      expect(response.id).toBe(777);
      expect(response.external_id).toBe('asaas/pay/001');
    });

    it('throws error if externalId is empty', async () => {
      const client = new AdaflowClient({ token: 'test-token' });
      await expect(client.getNfseByExternalId('')).rejects.toThrow(
        'external_id da NFSe é obrigatório',
      );
      await expect(client.getNfseByExternalId('   ')).rejects.toThrow(
        'external_id da NFSe é obrigatório',
      );
    });
  });

  describe('Error Handling and Status Code Mapping', () => {
    it('401 triggers AdaflowAuthError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({ message: 'Invalid API Token' }, 401),
      );

      const client = new AdaflowClient({ token: 'bad-token', fetchFn: mockFetch });

      await expect(client.getNfse(1)).rejects.toThrow(AdaflowAuthError);
      await expect(client.getNfse(1)).rejects.toThrow('Invalid API Token');

      try {
        await client.getNfse(1);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowAuthError);
        expect(err).toBeInstanceOf(AdaflowError);
        expect((err as AdaflowAuthError).status).toBe(401);
      }
    });

    it('404 triggers AdaflowNotFoundError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({ error: 'NFSe não encontrada' }, 404),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      await expect(client.getNfse(99999)).rejects.toThrow(AdaflowNotFoundError);
      await expect(client.getNfse(99999)).rejects.toThrow('NFSe não encontrada');

      try {
        await client.getNfse(99999);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowNotFoundError);
        expect(err).toBeInstanceOf(AdaflowError);
        expect((err as AdaflowNotFoundError).status).toBe(404);
      }
    });

    it('422 triggers AdaflowValidationError with error details', async () => {
      const validationPayload = {
        message: 'Tomador inválido',
        errors: {
          'service_taker.federal_tax_number': ['CPF ou CNPJ inválido'],
          cnae: ['Código CNAE inválido para o município emissor'],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(validationPayload, 422),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      try {
        await client.createNfse(samplePayload, 'key-1');
        expect.fail('Should have thrown AdaflowValidationError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowValidationError);
        expect(err).toBeInstanceOf(AdaflowError);
        const valErr = err as AdaflowValidationError;
        expect(valErr.status).toBe(422);
        expect(valErr.message).toBe('Tomador inválido');
        expect(valErr.errors).toEqual(validationPayload.errors);
      }
    });

    it('429 triggers AdaflowRateLimitError and parses integer Retry-After', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          { message: 'Rate limit exceeded. Maximum 5 requests per minute.' },
          429,
          { 'retry-after': '45' },
        ),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      try {
        await client.createNfse(samplePayload, 'key-2');
        expect.fail('Should have thrown AdaflowRateLimitError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowRateLimitError);
        expect(err).toBeInstanceOf(AdaflowError);
        const rateErr = err as AdaflowRateLimitError;
        expect(rateErr.status).toBe(429);
        expect(rateErr.retryAfter).toBe(45);
        expect(rateErr.message).toContain('Rate limit exceeded');
      }
    });

    it('429 parses HTTP-date Retry-After correctly', async () => {
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          { message: 'Too Many Requests' },
          429,
          { 'retry-after': futureDate },
        ),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      try {
        await client.createNfse(samplePayload, 'key-date');
        expect.fail('Should have thrown AdaflowRateLimitError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowRateLimitError);
        const rateErr = err as AdaflowRateLimitError;
        expect(rateErr.retryAfter).toBeGreaterThanOrEqual(58);
        expect(rateErr.retryAfter).toBeLessThanOrEqual(62);
      }
    });

    it('500+ triggers AdaflowServerError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({ error: 'Internal Server Error' }, 500),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      await expect(client.getNfse(10)).rejects.toThrow(AdaflowServerError);

      try {
        await client.getNfse(10);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowServerError);
        expect((err as AdaflowServerError).status).toBe(500);
      }
    });

    it('timeout handling triggers AdaflowTimeoutError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const mockFetch = vi.fn().mockRejectedValue(abortError);

      const client = new AdaflowClient({
        token: 'valid-token',
        timeoutMs: 100,
        fetchFn: mockFetch,
      });

      await expect(client.getNfse(10)).rejects.toThrow(AdaflowTimeoutError);

      try {
        await client.getNfse(10);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdaflowTimeoutError);
        expect(err).toBeInstanceOf(AdaflowError);
      }
    });

    it('malformed JSON on 200/202 triggers AdaflowError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse('<html><body>Bad Gateway</body></html>', 200, {
          'content-type': 'text/html',
        }),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      await expect(client.getNfse(10)).rejects.toThrow(AdaflowError);
    });

    it('malformed JSON on 500 triggers AdaflowServerError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse('Internal Server Crash', 503, {
          'content-type': 'text/plain',
        }),
      );

      const client = new AdaflowClient({ token: 'valid-token', fetchFn: mockFetch });

      await expect(client.getNfse(10)).rejects.toThrow(AdaflowServerError);
    });
  });

  describe('Adaflow Settings Storage', () => {
    it('saves, retrieves, checks, and removes the Adaflow token', async () => {
      expect(await getAdaflowToken()).toBeNull();
      expect(await hasAdaflowToken()).toBe(false);

      await saveAdaflowToken('test-secret-token-xyz');

      expect(await getAdaflowToken()).toBe('test-secret-token-xyz');
      expect(await hasAdaflowToken()).toBe(true);

      await removeAdaflowToken();

      expect(await getAdaflowToken()).toBeNull();
      expect(await hasAdaflowToken()).toBe(false);
    });

    it('rejects saving empty token', async () => {
      await expect(saveAdaflowToken('')).rejects.toThrow(
        'Token de API da Adaflow não pode ser vazio',
      );
      await expect(saveAdaflowToken('   ')).rejects.toThrow(
        'Token de API da Adaflow não pode ser vazio',
      );
    });
  });
});
