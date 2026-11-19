import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Payment } from '../../src/domain/payment';
import type { ServiceTemplate } from '../../src/domain/template';
import type { TakerProfile } from '../../src/domain/taker';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import IssueReviewScreen from '../../entrypoints/sidepanel/screens/IssueReviewScreen';

describe('IssueReviewScreen & Draft Isolation', () => {
  let testDb: PingouNotaDB;

  const sampleTemplate: ServiceTemplate = {
    id: 'tpl-software',
    name: 'Desenvolvimento de Software',
    cnae: '6201501',
    description: 'Serviços de desenvolvimento de software em {{mes}} de {{ano}}.',
    withholdTaxes: false,
    forwardingEmail: 'contato@dev.com',
  };

  const sampleTaker: TakerProfile = {
    id: 'taker-empresa',
    name: 'Empresa Alpha Ltda',
    document: '12345678000195',
    externalId: 'ext-alpha',
    email: 'financeiro@alpha.com',
    address: {
      line1: 'Avenida Paulista',
      number: '100',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01310-000',
      country: 'BR',
    },
  };

  const payment1: Payment = {
    provider: 'asaas',
    recordKey: 'pay_rev_1',
    sourcePaymentId: 'pay_1',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: null,
    payerName: 'Empresa Alpha Ltda',
    amountCents: 200000, // R$ 2.000,00
    currency: 'BRL',
    paymentDate: '2026-11-05',
    sourceStatus: 'RECEIVED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-05T10:00:00Z',
    manualDeclaredAt: null,
  };

  const payment2: Payment = {
    provider: 'asaas',
    recordKey: 'pay_rev_2',
    sourcePaymentId: 'pay_2',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: null,
    payerName: 'Empresa Beta Ltda',
    amountCents: 350000, // R$ 3.500,00
    currency: 'BRL',
    paymentDate: '2026-11-12',
    sourceStatus: 'RECEIVED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-12T10:00:00Z',
    manualDeclaredAt: null,
  };

  beforeEach(async () => {
    testDb = createDatabase(`test_ui_review_${crypto.randomUUID()}`);
    await testDb.open();
    await testDb.templates.put(sampleTemplate);
    await testDb.takers.put(sampleTaker);
    await testDb.payments.bulkPut([payment1, payment2]);
  });

  it('keeps draft items in React state and review cancellation writes nothing to database', async () => {
    const onCancelMock = vi.fn();
    const onConfirmedMock = vi.fn();

    render(
      <IssueReviewScreen
        payments={[payment1, payment2]}
        onCancel={onCancelMock}
        onConfirmed={onConfirmedMock}
        dbInstance={testDb}
      />,
    );

    // Wait for screen to load templates and takers
    await waitFor(() => {
      expect(screen.getByTestId('issue-review-screen')).toBeInTheDocument();
    });

    // Verify row components rendered with draft state
    expect(screen.getByText('Empresa Alpha Ltda')).toBeInTheDocument();
    expect(screen.getByText('Empresa Beta Ltda')).toBeInTheDocument();

    // Click "Cancelar"
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    fireEvent.click(cancelBtn);

    expect(onCancelMock).toHaveBeenCalledTimes(1);
    expect(onConfirmedMock).not.toHaveBeenCalled();

    // Assert that ZERO operations were created in database
    const operationsCount = await testDb.nfseOperations.count();
    expect(operationsCount).toBe(0);

    // Assert that payment declarationState was NOT mutated
    const p1 = await testDb.payments.get(['asaas', 'pay_rev_1']);
    const p2 = await testDb.payments.get(['asaas', 'pay_rev_2']);
    expect(p1?.declarationState).toBe('nao_declarado');
    expect(p2?.declarationState).toBe('nao_declarado');
  });

  it('renders rows with taker and template defaults and formatted summary', async () => {
    render(
      <IssueReviewScreen
        payments={[payment1, payment2]}
        onCancel={vi.fn()}
        dbInstance={testDb}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('issue-review-screen')).toBeInTheDocument();
    });

    // Check defaults rendered
    expect(screen.getByTestId('summary-count')).toHaveTextContent('2 de 2 válidas');
    expect(screen.getByTestId('summary-total-brl')).toHaveTextContent('R$ 5.500,00');

    // Warning badge should not be present on valid rows
    expect(screen.queryByTestId('warning-badge')).not.toBeInTheDocument();

    // Description textareas should display rendered template tokens
    const textareas = screen.getAllByLabelText('Descrição na Nota');
    expect(textareas[0]).toHaveValue(
      'Serviços de desenvolvimento de software em novembro de 2026.',
    );
  });

  it('displays warning badge on invalid row and excludes it from confirmation submission', async () => {
    // Taker without document
    const invalidTaker: TakerProfile = {
      id: 'taker-nodoc',
      name: 'Tomador Sem CPF',
      document: null,
      externalId: null,
      email: null,
      address: {
        line1: 'Rua Sem Fim',
        number: null,
        neighborhood: null,
        city: 'Curitiba',
        state: 'PR',
        postalCode: '80000-000',
        country: 'BR',
      },
    };
    await testDb.takers.put(invalidTaker);

    render(
      <IssueReviewScreen
        payments={[payment1, payment2]}
        onCancel={vi.fn()}
        dbInstance={testDb}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('issue-review-screen')).toBeInTheDocument();
    });

    // Change first row taker to the invalid taker
    const takerSelects = screen.getAllByLabelText('Tomador');
    fireEvent.change(takerSelects[0]!, { target: { value: 'taker-nodoc' } });

    // Warning badge should now appear for row 1
    await waitFor(() => {
      expect(screen.getByTestId('warning-badge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('inline-validation-errors')).toHaveTextContent(
      'Tomador brasileiro sem CPF/CNPJ válido.',
    );

    // Summary should now show 1 of 2 valid
    expect(screen.getByTestId('summary-count')).toHaveTextContent('1 de 2 válidas');
    expect(screen.getByTestId('summary-total-brl')).toHaveTextContent('R$ 3.500,00');
  });

  it('persists distinct operations and updates declarationState to emissao_solicitada on confirmation', async () => {
    const onConfirmedMock = vi.fn();

    render(
      <IssueReviewScreen
        payments={[payment1, payment2]}
        onCancel={vi.fn()}
        onConfirmed={onConfirmedMock}
        dbInstance={testDb}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('issue-review-screen')).toBeInTheDocument();
    });

    // Click confirm button
    const confirmBtn = screen.getByRole('button', {
      name: /Confirmar e Enviar para Fila/,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onConfirmedMock).toHaveBeenCalledTimes(1);
    });

    // Verify operations persisted in Dexie
    const operations = await testDb.nfseOperations.toArray();
    expect(operations).toHaveLength(2);

    const op1 = operations.find((o) => o.paymentRecordKey === 'pay_rev_1')!;
    const op2 = operations.find((o) => o.paymentRecordKey === 'pay_rev_2')!;
    expect(op1).toBeDefined();
    expect(op2).toBeDefined();
    expect(op1.id).not.toBe(op2.id);

    // Idempotency keys must be distinct UUIDs
    expect(op1.idempotencyKey).toBeTruthy();
    expect(op2.idempotencyKey).toBeTruthy();
    expect(op1.idempotencyKey).not.toBe(op2.idempotencyKey);

    // External IDs format: provider_recordKey_operationId
    expect(op1.externalId).toBe(`asaas_${op1.paymentRecordKey}_${op1.id}`);
    expect(op2.externalId).toBe(`asaas_${op2.paymentRecordKey}_${op2.id}`);

    // Status queued
    expect(op1.status).toBe('queued');
    expect(op2.status).toBe('queued');

    // Payloads must be valid JSON matching NfseIssuePayload
    const payload1 = JSON.parse(op1.payloadJson || '{}');
    expect(payload1.value_cents).toBe(200000);
    expect(payload1.cnae).toBe('6201501');

    const payload2 = JSON.parse(op2.payloadJson || '{}');
    expect(payload2.value_cents).toBe(350000);
    expect(payload2.cnae).toBe('6201501');

    // Verify payments declarationState updated in Dexie
    const p1 = await testDb.payments.get(['asaas', 'pay_rev_1']);
    const p2 = await testDb.payments.get(['asaas', 'pay_rev_2']);
    expect(p1?.declarationState).toBe('emissao_solicitada');
    expect(p1?.linkedNfseOperationId).toBe(op1.id);
    expect(p2?.declarationState).toBe('emissao_solicitada');
    expect(p2?.linkedNfseOperationId).toBe(op2.id);
  });
});
