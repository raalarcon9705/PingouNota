import { describe, expect, it } from 'vitest';
import type { Payment } from '../../src/domain/payment';
import {
  canDeclarePayment,
  markPaymentLocally,
  normalizePaymentState,
  reconcilePaymentObservation,
} from '../../src/domain/declaration';
import {
  brazilianServiceTakerSchema,
  isValidBrazilianDocument,
  isValidCpf,
  isValidCnpj,
  takerProfileSchema,
} from '../../src/domain/taker';
import { serviceTemplateSchema } from '../../src/domain/template';
import { nfseIssuePayloadSchema } from '../../src/domain/nfse-operation';

function createSamplePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    provider: 'asaas',
    recordKey: 'pay_123',
    sourcePaymentId: 'pay_123',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: 'fp_123',
    payerName: 'Cliente Exemplo Ltda',
    amountCents: 150000,
    currency: 'BRL',
    paymentDate: '2026-11-19',
    sourceStatus: 'Recebido',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-19T10:00:00Z',
    manualDeclaredAt: null,
    ...overrides,
  };
}

describe('Payment State and Declaration Rules', () => {
  it('only recebido with unambiguous identity can be declared', () => {
    const validPayment = createSamplePayment({
      paymentState: 'recebido',
      ambiguousIdentity: false,
      declarationState: 'nao_declarado',
    });

    const check = canDeclarePayment(validPayment);
    expect(check.allowed).toBe(true);
    expect(check.reason).toBeUndefined();

    // Retrying a failed declaration is also allowed
    const retryablePayment = createSamplePayment({
      paymentState: 'recebido',
      ambiguousIdentity: false,
      declarationState: 'falha_adaflow',
    });
    expect(canDeclarePayment(retryablePayment).allowed).toBe(true);

    // markPaymentLocally succeeds on eligible payment
    const marked = markPaymentLocally(validPayment, '2026-11-19T12:00:00Z');
    expect(marked.declarationState).toBe('marcado_localmente');
    expect(marked.manualDeclaredAt).toBe('2026-11-19T12:00:00Z');
  });

  it('pending, reversed, unknown, or ambiguous identity cannot be declared', () => {
    // Pending payment
    const pendingPayment = createSamplePayment({
      paymentState: 'aguardando_recebimento',
    });
    const pendingCheck = canDeclarePayment(pendingPayment);
    expect(pendingCheck.allowed).toBe(false);
    expect(pendingCheck.reason).toContain('recebido');
    expect(() => markPaymentLocally(pendingPayment)).toThrow();

    // Reversed payment
    const reversedPayment = createSamplePayment({
      paymentState: 'revertido_ou_cancelado',
    });
    const reversedCheck = canDeclarePayment(reversedPayment);
    expect(reversedCheck.allowed).toBe(false);
    expect(reversedCheck.reason).toContain('recebido');

    // Unknown payment state
    const unknownPayment = createSamplePayment({
      paymentState: 'desconhecido',
    });
    const unknownCheck = canDeclarePayment(unknownPayment);
    expect(unknownCheck.allowed).toBe(false);
    expect(unknownCheck.reason).toContain('recebido');

    // Ambiguous identity (even if recebido)
    const ambiguousPayment = createSamplePayment({
      paymentState: 'recebido',
      ambiguousIdentity: true,
    });
    const ambiguousCheck = canDeclarePayment(ambiguousPayment);
    expect(ambiguousCheck.allowed).toBe(false);
    expect(ambiguousCheck.reason).toContain('ambígua');
    expect(() => markPaymentLocally(ambiguousPayment)).toThrow();

    // Already declared payments cannot be declared again
    const alreadyMarked = createSamplePayment({
      paymentState: 'recebido',
      declarationState: 'marcado_localmente',
    });
    expect(canDeclarePayment(alreadyMarked).allowed).toBe(false);

    const alreadyIssued = createSamplePayment({
      paymentState: 'recebido',
      declarationState: 'emitida_adaflow',
    });
    expect(canDeclarePayment(alreadyIssued).allowed).toBe(false);

    const inFlight = createSamplePayment({
      paymentState: 'recebido',
      declarationState: 'emissao_solicitada',
    });
    expect(canDeclarePayment(inFlight).allowed).toBe(false);
  });

  it('observation updates preserve declarationState and manualDeclaredAt', () => {
    const existing = createSamplePayment({
      declarationState: 'marcado_localmente',
      manualDeclaredAt: '2026-11-19T08:00:00Z',
      linkedNfseOperationId: 'op_abc',
    });

    const observedUpdate: Partial<Payment> = {
      payerName: 'Cliente Atualizado Ltda',
      amountCents: 155000,
      sourceStatus: 'Recebido',
      lastObservedAt: '2026-11-19T11:00:00Z',
    };

    const reconciled = reconcilePaymentObservation(existing, observedUpdate);

    expect(reconciled.declarationState).toBe('marcado_localmente');
    expect(reconciled.manualDeclaredAt).toBe('2026-11-19T08:00:00Z');
    expect(reconciled.linkedNfseOperationId).toBe('op_abc');
    expect(reconciled.payerName).toBe('Cliente Atualizado Ltda');
    expect(reconciled.amountCents).toBe(155000);
    expect(reconciled.lastObservedAt).toBe('2026-11-19T11:00:00Z');
    expect(reconciled.reversalFlaggedForReview).toBe(false);
  });

  it('preserves existing payerName, amountCents, currency, and paymentDate when observed has null values', () => {
    const existing = createSamplePayment({
      payerName: 'Empresa Alpha Ltda',
      amountCents: 99000,
      currency: 'BRL',
      paymentDate: '2026-11-15',
      sourcePaymentId: 'pay_alpha_1',
      identityFingerprint: 'fp_alpha',
    });

    const observedWithNulls: Partial<Payment> = {
      payerName: null,
      amountCents: null,
      currency: null,
      paymentDate: null,
      sourcePaymentId: null,
      identityFingerprint: null,
      lastObservedAt: '2026-11-19T12:00:00Z',
    };

    const reconciled = reconcilePaymentObservation(existing, observedWithNulls);

    expect(reconciled.payerName).toBe('Empresa Alpha Ltda');
    expect(reconciled.amountCents).toBe(99000);
    expect(reconciled.currency).toBe('BRL');
    expect(reconciled.paymentDate).toBe('2026-11-15');
    expect(reconciled.sourcePaymentId).toBe('pay_alpha_1');
    expect(reconciled.identityFingerprint).toBe('fp_alpha');
    expect(reconciled.lastObservedAt).toBe('2026-11-19T12:00:00Z');
  });

  it('reversal after declaration sets flag for review', () => {
    // Case 1: Locally marked payment observed as reversed
    const markedPayment = createSamplePayment({
      declarationState: 'marcado_localmente',
      manualDeclaredAt: '2026-11-19T08:00:00Z',
      paymentState: 'recebido',
    });

    const reversedObservation: Partial<Payment> = {
      sourceStatus: 'Estornado',
      paymentState: 'revertido_ou_cancelado',
    };

    const reconciledMarked = reconcilePaymentObservation(markedPayment, reversedObservation);
    expect(reconciledMarked.reversalFlaggedForReview).toBe(true);
    expect(reconciledMarked.paymentState).toBe('revertido_ou_cancelado');
    expect(reconciledMarked.declarationState).toBe('marcado_localmente');

    // Case 2: Issued via Adaflow observed as cancelled/reversed
    const issuedPayment = createSamplePayment({
      declarationState: 'emitida_adaflow',
      manualDeclaredAt: null,
      paymentState: 'recebido',
    });

    const reconciledIssued = reconcilePaymentObservation(issuedPayment, {
      sourceStatus: 'Cancelado',
      paymentState: 'revertido_ou_cancelado',
    });
    expect(reconciledIssued.reversalFlaggedForReview).toBe(true);

    // Case 3: Reversal of an undeclared payment does NOT flag review
    const undeclaredPayment = createSamplePayment({
      declarationState: 'nao_declarado',
      paymentState: 'aguardando_recebimento',
    });

    const reconciledUndeclared = reconcilePaymentObservation(undeclaredPayment, {
      sourceStatus: 'Cancelado',
      paymentState: 'revertido_ou_cancelado',
    });
    expect(reconciledUndeclared.reversalFlaggedForReview).toBe(false);
  });

  it('unrecognized source states map to desconhecido', () => {
    // Asaas known and unknown
    expect(normalizePaymentState('Recebido', 'asaas')).toBe('recebido');
    expect(normalizePaymentState('CONFIRMADO', 'asaas')).toBe('recebido');
    expect(normalizePaymentState('Pendente', 'asaas')).toBe('aguardando_recebimento');
    expect(normalizePaymentState('Aguardando pagamento', 'asaas')).toBe('aguardando_recebimento');
    expect(normalizePaymentState('Estornado', 'asaas')).toBe('revertido_ou_cancelado');
    expect(normalizePaymentState('Em análise de risco', 'asaas')).toBe('desconhecido');
    expect(normalizePaymentState('Algo Inesperado', 'asaas')).toBe('desconhecido');

    // Husky known and unknown
    expect(normalizePaymentState('Na conta', 'husky')).toBe('recebido');
    expect(normalizePaymentState('Concluído', 'husky')).toBe('recebido');
    expect(normalizePaymentState('Arrived', 'husky')).toBe('recebido');
    expect(normalizePaymentState('A caminho', 'husky')).toBe('aguardando_recebimento');
    expect(normalizePaymentState('In transit', 'husky')).toBe('aguardando_recebimento');
    expect(normalizePaymentState('Cancelado', 'husky')).toBe('revertido_ou_cancelado');
    expect(normalizePaymentState('Devolvido', 'husky')).toBe('revertido_ou_cancelado');
    expect(normalizePaymentState('Under review', 'husky')).toBe('desconhecido');
    expect(normalizePaymentState('Status Novo', 'husky')).toBe('desconhecido');

    // Null or undefined
    expect(normalizePaymentState(null)).toBe('desconhecido');
    expect(normalizePaymentState(undefined)).toBe('desconhecido');
    expect(normalizePaymentState('')).toBe('desconhecido');
  });
});

describe('Domain Schemas and Validation', () => {
  it('validates Brazilian CPF correctly', () => {
    // Valid CPFs
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);

    // Invalid check digits
    expect(isValidCpf('52998224720')).toBe(false);

    // Invalid repeated digits
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);

    // Invalid lengths
    expect(isValidCpf('12345')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });

  it('validates Brazilian CNPJ correctly', () => {
    // Valid CNPJs
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);

    // Invalid check digits
    expect(isValidCnpj('11222333000182')).toBe(false);

    // Invalid repeated digits
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);

    // Invalid length
    expect(isValidCnpj('1234567890123')).toBe(false);
  });

  it('validates Brazilian document helper', () => {
    expect(isValidBrazilianDocument('529.982.247-25')).toBe(true);
    expect(isValidBrazilianDocument('11.222.333/0001-81')).toBe(true);
    expect(isValidBrazilianDocument('invalid-doc')).toBe(false);
  });

  it('validates Brazilian service taker requires name, valid document and address', () => {
    const validTaker = {
      name: 'Tomador Exemplo Ltda',
      document: '11.222.333/0001-81',
      address: {
        line1: 'Av. Paulista, 1000',
        city: 'São Paulo',
        state: 'SP',
        postal_code: '01310-100',
      },
    };
    expect(brazilianServiceTakerSchema.safeParse(validTaker).success).toBe(true);

    // Missing document
    const missingDoc = { ...validTaker, document: '' };
    expect(brazilianServiceTakerSchema.safeParse(missingDoc).success).toBe(false);

    // Invalid document
    const invalidDoc = { ...validTaker, document: '12345678901' };
    expect(brazilianServiceTakerSchema.safeParse(invalidDoc).success).toBe(false);

    // Missing address field
    const missingAddress = {
      ...validTaker,
      address: { line1: 'Rua A', city: 'São Paulo', state: 'SP', postal_code: '' },
    };
    expect(brazilianServiceTakerSchema.safeParse(missingAddress).success).toBe(false);
  });

  it('validates taker profile local schema', () => {
    const validProfile = {
      id: 'taker_001',
      name: 'Tomador Local Ltda',
      document: '11.222.333/0001-81',
      externalId: 'ext_123',
      email: 'contato@tomador.com',
      address: {
        line1: 'Rua das Flores, 123',
        number: '123',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01001-000',
        country: 'BR',
      },
    };
    expect(takerProfileSchema.safeParse(validProfile).success).toBe(true);

    // Profile with null optional fields is also valid
    const minimalProfile = {
      id: 'taker_002',
      name: 'Tomador Mínimo',
      document: null,
      externalId: null,
      email: null,
      address: {
        line1: 'Rua das Flores, 123',
        number: null,
        neighborhood: null,
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01001-000',
        country: 'BR',
      },
    };
    expect(takerProfileSchema.safeParse(minimalProfile).success).toBe(true);
  });

  it('validates service template schema', () => {
    const validTemplate = {
      id: 'tmpl_1',
      name: 'Desenvolvimento de Software',
      cnae: '6201-5/01',
      description: 'Serviços de desenvolvimento de software referentes a {{mes}}/{{ano}}.',
      withholdTaxes: false,
      forwardingEmail: 'contabilidade@exemplo.com',
    };
    expect(serviceTemplateSchema.safeParse(validTemplate).success).toBe(true);

    // Invalid email
    const invalidEmailTemplate = { ...validTemplate, forwardingEmail: 'not-an-email' };
    expect(serviceTemplateSchema.safeParse(invalidEmailTemplate).success).toBe(false);

    // Missing required cnae
    const missingCnae = { ...validTemplate, cnae: '' };
    expect(serviceTemplateSchema.safeParse(missingCnae).success).toBe(false);
  });

  it('validates NFSe issue payload for domestic and supported foreign currencies', () => {
    const baseTaker = {
      document: '11222333000181',
      name: 'Tomador Ltda',
      address: {
        line1: 'Rua Exemplo',
        city: 'Curitiba',
        state: 'PR',
        postal_code: '80000-000',
      },
    };

    // Valid domestic payload
    const domestic = {
      cnae: '6201-5/01',
      description: 'Consultoria técnica',
      value_cents: 250000,
      withhold_taxes: false,
      external_id: 'ext_001',
      service_taker: baseTaker,
    };
    expect(nfseIssuePayloadSchema.safeParse(domestic).success).toBe(true);

    // Valid foreign payload (USD)
    const foreignUsd = {
      cnae: '6201-5/01',
      description: 'Software development',
      foreign_value_cents: 420000,
      foreign_value_currency: 'USD',
      withhold_taxes: false,
      external_id: 'ext_002',
      service_taker: baseTaker,
    };
    expect(nfseIssuePayloadSchema.safeParse(foreignUsd).success).toBe(true);

    // Supported foreign currencies: USD, EUR, GBP, CAD, AUD
    for (const cur of ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const) {
      expect(
        nfseIssuePayloadSchema.safeParse({ ...foreignUsd, foreign_value_currency: cur }).success,
      ).toBe(true);
    }

    // Unsupported foreign currency
    expect(
      nfseIssuePayloadSchema.safeParse({
        ...foreignUsd,
        foreign_value_currency: 'JPY',
      }).success,
    ).toBe(false);

    // Missing both domestic and foreign amounts
    expect(
      nfseIssuePayloadSchema.safeParse({
        cnae: '6201-5/01',
        description: 'Serviço sem valor',
        withhold_taxes: false,
        external_id: 'ext_003',
        service_taker: baseTaker,
      }).success,
    ).toBe(false);
  });
});

