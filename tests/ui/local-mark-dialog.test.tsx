import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Payment } from '../../src/domain/payment';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import {
  LocalMarkDialog,
  VERBATIM_DISCLAIMER,
} from '../../entrypoints/sidepanel/components/LocalMarkDialog';

describe('LocalMarkDialog', () => {
  let testDb: PingouNotaDB;

  const mockPayments: Payment[] = [
    {
      provider: 'asaas',
      recordKey: 'pay_mark_01',
      sourcePaymentId: 'src_01',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Empresa Alpha Ltda',
      amountCents: 125000, // R$ 1.250,00
      currency: 'BRL',
      paymentDate: '2026-11-10',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-10T12:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'husky',
      recordKey: 'pay_mark_02',
      sourcePaymentId: 'src_02',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Beta US Corp',
      amountCents: 200000, // $ 2,000.00
      currency: 'USD',
      paymentDate: '2026-11-12',
      sourceStatus: 'COMPLETED',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-12T14:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'asaas',
      recordKey: 'pay_mark_03',
      sourcePaymentId: 'src_03',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Gamma Servicos',
      amountCents: 85000, // R$ 850,00
      currency: 'BRL',
      paymentDate: '2026-11-15',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-15T09:00:00Z',
      manualDeclaredAt: null,
    },
  ];

  beforeEach(async () => {
    testDb = createDatabase(`test-local-mark-db-${Date.now()}-${Math.random()}`);
    await testDb.payments.clear();

    // Populate database with the initial payments
    for (const p of mockPayments) {
      await testDb.payments.put({ ...p });
    }
  });

  it('renders the approved disclaimer text verbatim', () => {
    render(
      <LocalMarkDialog
        isOpen={true}
        payments={mockPayments}
        onClose={vi.fn()}
        dbInstance={testDb}
      />,
    );

    const disclaimerEl = screen.getByTestId('local-mark-disclaimer');
    expect(disclaimerEl).toBeInTheDocument();
    expect(disclaimerEl.textContent).toContain(VERBATIM_DISCLAIMER);
    expect(disclaimerEl.textContent).toContain(
      'Esta ação atualiza apenas o registro local da extensão. Ela não emite uma NFSe nem consulta notas emitidas na Adaflow.',
    );
  });

  it('renders the summary of selected payments (count, payer names, amounts)', () => {
    render(
      <LocalMarkDialog
        isOpen={true}
        payments={mockPayments}
        onClose={vi.fn()}
        dbInstance={testDb}
      />,
    );

    expect(screen.getByTestId('summary-count')).toHaveTextContent('3 pagamentos');
    expect(screen.getByText('Empresa Alpha Ltda')).toBeInTheDocument();
    expect(screen.getByText('Beta US Corp')).toBeInTheDocument();
    expect(screen.getByText('Gamma Servicos')).toBeInTheDocument();
  });

  it('leaves database unchanged and closes on cancellation', async () => {
    const handleClose = vi.fn();

    render(
      <LocalMarkDialog
        isOpen={true}
        payments={mockPayments}
        onClose={handleClose}
        dbInstance={testDb}
      />,
    );

    const cancelBtn = screen.getByTestId('btn-cancel-marking');
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);

    // Verify all records in Dexie remain nao_declarado with null manualDeclaredAt
    const dbPayments = await testDb.payments.toArray();
    expect(dbPayments).toHaveLength(3);
    for (const p of dbPayments) {
      expect(p.declarationState).toBe('nao_declarado');
      expect(p.manualDeclaredAt).toBeNull();
    }
  });

  it('performs multi-mark timestamping in Dexie repository without any network or Adaflow calls', async () => {
    // Spy on global fetch to ensure NO network requests are made
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const handleSuccess = vi.fn();

    render(
      <LocalMarkDialog
        isOpen={true}
        payments={mockPayments}
        onClose={vi.fn()}
        onSuccess={handleSuccess}
        dbInstance={testDb}
      />,
    );

    const confirmBtn = screen.getByTestId('btn-confirm-marking');
    fireEvent.click(confirmBtn);

    // Wait for the completion summary to appear
    await waitFor(() => {
      expect(screen.getByTestId('completion-summary')).toBeInTheDocument();
    });

    // Verify completion summary shows correct marked count
    const summary = screen.getByTestId('completion-summary');
    expect(summary).toHaveTextContent('3 pagamentos foram marcados como emitidos localmente.');

    // Verify callback was called with marked count
    expect(handleSuccess).toHaveBeenCalledWith(3);

    // CRITICAL: Verify absolutely zero network calls to Adaflow or external APIs
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // Verify Dexie database state for each payment
    const p1 = await testDb.payments.get(['asaas', 'pay_mark_01']);
    const p2 = await testDb.payments.get(['husky', 'pay_mark_02']);
    const p3 = await testDb.payments.get(['asaas', 'pay_mark_03']);

    expect(p1?.declarationState).toBe('marcado_localmente');
    expect(p1?.manualDeclaredAt).toBeTruthy();
    expect(new Date(p1!.manualDeclaredAt!).getTime()).not.toBeNaN();

    expect(p2?.declarationState).toBe('marcado_localmente');
    expect(p2?.manualDeclaredAt).toBeTruthy();

    expect(p3?.declarationState).toBe('marcado_localmente');
    expect(p3?.manualDeclaredAt).toBeTruthy();
  });

  it('shows completion summary for a single payment marked correctly', async () => {
    const singlePayment: Payment[] = [mockPayments[0]!];

    render(
      <LocalMarkDialog
        isOpen={true}
        payments={singlePayment}
        onClose={vi.fn()}
        dbInstance={testDb}
      />,
    );

    const confirmBtn = screen.getByTestId('btn-confirm-marking');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('completion-summary')).toBeInTheDocument();
    });

    const summary = screen.getByTestId('completion-summary');
    expect(summary).toHaveTextContent('1 pagamento foi marcado como emitido localmente.');
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <LocalMarkDialog
        isOpen={false}
        payments={mockPayments}
        onClose={vi.fn()}
        dbInstance={testDb}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
