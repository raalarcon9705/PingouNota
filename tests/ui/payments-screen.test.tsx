import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Payment } from '../../src/domain/payment';
import PaymentsScreen, {
  calculatePaymentSummary,
  sortPayments,
} from '../../entrypoints/sidepanel/screens/PaymentsScreen';
import { filterPayments, type FilterState } from '../../entrypoints/sidepanel/components/PaymentFilters';
import {
  getSelectionEligibility,
  formatCurrency,
  formatDatePtBr,
} from '../../entrypoints/sidepanel/components/PaymentRow';
import { isSupportedPortalUrl } from '../../entrypoints/sidepanel/App';

describe('PaymentsScreen & UI Components', () => {
  // Synthetic dataset covering every single paymentState and declarationState plus edge cases
  const syntheticPayments: Payment[] = [
    {
      provider: 'asaas',
      recordKey: 'pay_rec_undeclared_brl',
      sourcePaymentId: 'pay_1',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Alfa BRL',
      amountCents: 150000, // R$ 1.500,00
      currency: 'BRL',
      paymentDate: '2026-11-10',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-10T10:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'husky',
      recordKey: 'pay_rec_undeclared_usd',
      sourcePaymentId: 'pay_2',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Beta USD',
      amountCents: 250000, // $ 2,500.00
      currency: 'USD',
      paymentDate: '2026-11-15',
      sourceStatus: 'COMPLETED',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-15T12:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'asaas',
      recordKey: 'pay_rec_ambiguous',
      sourcePaymentId: null,
      identityConfidence: 'low',
      ambiguousIdentity: true,
      identityFingerprint: 'fp_ambig_1',
      payerName: 'Cliente Ambíguo',
      amountCents: 90000,
      currency: 'BRL',
      paymentDate: '2026-11-12',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-12T09:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'asaas',
      recordKey: 'pay_rec_local_marked',
      sourcePaymentId: 'pay_4',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Marcado Localmente',
      amountCents: 50000, // R$ 500,00
      currency: 'BRL',
      paymentDate: '2026-11-20',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'marcado_localmente',
      lastObservedAt: '2026-11-20T14:00:00Z',
      manualDeclaredAt: '2026-11-20T15:00:00Z',
    },
    {
      provider: 'husky',
      recordKey: 'pay_rec_issued_adaflow',
      sourcePaymentId: 'pay_5',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Emitido Adaflow',
      amountCents: 30000, // R$ 300,00
      currency: 'BRL',
      paymentDate: '2026-11-18',
      sourceStatus: 'COMPLETED',
      paymentState: 'recebido',
      declarationState: 'emitida_adaflow',
      lastObservedAt: '2026-11-18T11:00:00Z',
      manualDeclaredAt: null,
      linkedNfseOperationId: 'nfse_123',
    },
    {
      provider: 'asaas',
      recordKey: 'pay_rec_solicitada',
      sourcePaymentId: 'pay_6',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Emissão Solicitada',
      amountCents: 40000, // R$ 400,00
      currency: 'BRL',
      paymentDate: '2026-11-17',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'emissao_solicitada',
      lastObservedAt: '2026-11-17T11:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'asaas',
      recordKey: 'pay_rec_falha_adaflow',
      sourcePaymentId: 'pay_7',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Falha Adaflow',
      amountCents: 20000, // R$ 200,00
      currency: 'BRL',
      paymentDate: '2026-11-16',
      sourceStatus: 'RECEIVED',
      paymentState: 'recebido',
      declarationState: 'falha_adaflow',
      lastObservedAt: '2026-11-16T11:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'husky',
      recordKey: 'pay_rec_cancelada_adaflow',
      sourcePaymentId: 'pay_8',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Cancelada Adaflow',
      amountCents: 10000, // R$ 100,00
      currency: 'BRL',
      paymentDate: '2026-11-14',
      sourceStatus: 'COMPLETED',
      paymentState: 'recebido',
      declarationState: 'cancelada_adaflow',
      lastObservedAt: '2026-11-14T11:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'asaas',
      recordKey: 'pay_pending_brl',
      sourcePaymentId: 'pay_9',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Pendente',
      amountCents: 80000, // R$ 800,00
      currency: 'BRL',
      paymentDate: '2026-11-21',
      sourceStatus: 'PENDING',
      paymentState: 'aguardando_recebimento',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-21T08:00:00Z',
      manualDeclaredAt: null,
    },
    {
      provider: 'asaas',
      recordKey: 'pay_reverted',
      sourcePaymentId: 'pay_10',
      identityConfidence: 'high',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Revertido',
      amountCents: 60000,
      currency: 'BRL',
      paymentDate: '2026-11-05',
      sourceStatus: 'REFUNDED',
      paymentState: 'revertido_ou_cancelado',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-05T08:00:00Z',
      manualDeclaredAt: null,
      reversalFlaggedForReview: true,
    },
    {
      provider: 'husky',
      recordKey: 'pay_unknown',
      sourcePaymentId: 'pay_11',
      identityConfidence: 'low',
      ambiguousIdentity: false,
      identityFingerprint: null,
      payerName: 'Cliente Estado Desconhecido',
      amountCents: 70000,
      currency: 'BRL',
      paymentDate: '2026-11-01',
      sourceStatus: 'OTHER',
      paymentState: 'desconhecido',
      declarationState: 'nao_declarado',
      lastObservedAt: '2026-11-01T08:00:00Z',
      manualDeclaredAt: null,
    },
  ];

  describe('Summary calculation selector', () => {
    it('calculates received and pending counts and totals independently', () => {
      const summary = calculatePaymentSummary(syntheticPayments);

      // 8 received payments (pay_rec_*)
      expect(summary.receivedCount).toBe(8);
      // 1 pending payment (pay_pending_brl)
      expect(summary.pendingCount).toBe(1);
      // 1 reverted payment
      expect(summary.revertedCount).toBe(1);
      // 1 unknown payment
      expect(summary.unknownCount).toBe(1);
      expect(summary.totalCount).toBe(11);

      // BRL cents for received payments: 150000 + 90000 + 50000 + 30000 + 40000 + 20000 + 10000 = 390000
      expect(summary.receivedTotalBrlCents).toBe(390000);
      // BRL cents for pending: 80000
      expect(summary.pendingTotalBrlCents).toBe(80000);
    });

    it('renders summary cards with correct counts and formatted amounts in the DOM', () => {
      render(<PaymentsScreen payments={syntheticPayments} />);

      const receivedCard = screen.getByTestId('summary-received');
      expect(within(receivedCard).getByText('Recebidos')).toBeInTheDocument();
      expect(within(receivedCard).getByTestId('summary-received-count')).toHaveTextContent('8');
      expect(within(receivedCard).getByTestId('summary-received-amount')).toHaveTextContent(
        /R\$\s*3\.900,00\s*\(BRL\)/,
      );

      const pendingCard = screen.getByTestId('summary-pending');
      expect(within(pendingCard).getByText('Pendentes')).toBeInTheDocument();
      expect(within(pendingCard).getByTestId('summary-pending-count')).toHaveTextContent('1');
      expect(within(pendingCard).getByTestId('summary-pending-amount')).toHaveTextContent(
        /R\$\s*800,00\s*\(BRL\)/,
      );
    });
  });

  describe('Sorting', () => {
    it('sorts received undeclared payments first, then newest date', () => {
      const sorted = sortPayments(syntheticPayments);

      // First 3 should all be received + undeclared:
      // pay_rec_undeclared_usd (2026-11-15), pay_rec_ambiguous (2026-11-12), pay_rec_undeclared_brl (2026-11-10)
      expect(sorted[0]!.recordKey).toBe('pay_rec_undeclared_usd');
      expect(sorted[1]!.recordKey).toBe('pay_rec_ambiguous');
      expect(sorted[2]!.recordKey).toBe('pay_rec_undeclared_brl');

      // The rest are sorted by newest date descending:
      // 2026-11-21 (pay_pending_brl)
      expect(sorted[3]!.recordKey).toBe('pay_pending_brl');
      // 2026-11-20 (pay_rec_local_marked)
      expect(sorted[4]!.recordKey).toBe('pay_rec_local_marked');
      // 2026-11-18 (pay_rec_issued_adaflow)
      expect(sorted[5]!.recordKey).toBe('pay_rec_issued_adaflow');
    });
  });

  describe('Filtering', () => {
    it('filters by provider accurately', () => {
      const asaasFilter: FilterState = {
        provider: 'asaas',
        paymentState: 'all',
        declarationState: 'all',
      };
      const asaasResults = filterPayments(syntheticPayments, asaasFilter);
      expect(asaasResults.every((p) => p.provider === 'asaas')).toBe(true);
      expect(asaasResults.length).toBe(7);

      const huskyFilter: FilterState = {
        provider: 'husky',
        paymentState: 'all',
        declarationState: 'all',
      };
      const huskyResults = filterPayments(syntheticPayments, huskyFilter);
      expect(huskyResults.every((p) => p.provider === 'husky')).toBe(true);
      expect(huskyResults.length).toBe(4);
    });

    it('filters by payment state accurately', () => {
      const receivedFilter: FilterState = {
        provider: 'all',
        paymentState: 'recebido',
        declarationState: 'all',
      };
      const receivedResults = filterPayments(syntheticPayments, receivedFilter);
      expect(receivedResults.every((p) => p.paymentState === 'recebido')).toBe(true);
      expect(receivedResults.length).toBe(8);

      const pendingFilter: FilterState = {
        provider: 'all',
        paymentState: 'aguardando_recebimento',
        declarationState: 'all',
      };
      const pendingResults = filterPayments(syntheticPayments, pendingFilter);
      expect(pendingResults.every((p) => p.paymentState === 'aguardando_recebimento')).toBe(true);
      expect(pendingResults.length).toBe(1);

      const revertedFilter: FilterState = {
        provider: 'all',
        paymentState: 'revertido_ou_cancelado',
        declarationState: 'all',
      };
      const revertedResults = filterPayments(syntheticPayments, revertedFilter);
      expect(revertedResults.every((p) => p.paymentState === 'revertido_ou_cancelado')).toBe(true);
      expect(revertedResults.length).toBe(1);
    });

    it('filters by declaration state accurately', () => {
      const undeclaredFilter: FilterState = {
        provider: 'all',
        paymentState: 'all',
        declarationState: 'nao_declarado',
      };
      const undeclaredResults = filterPayments(syntheticPayments, undeclaredFilter);
      expect(undeclaredResults.every((p) => p.declarationState === 'nao_declarado')).toBe(true);
      expect(undeclaredResults.length).toBe(6);

      const localMarkedFilter: FilterState = {
        provider: 'all',
        paymentState: 'all',
        declarationState: 'marcado_localmente',
      };
      const localMarkedResults = filterPayments(syntheticPayments, localMarkedFilter);
      expect(localMarkedResults.length).toBe(1);
      expect(localMarkedResults[0]!.recordKey).toBe('pay_rec_local_marked');
    });

    it('reacts to filter dropdown changes in PaymentsScreen UI', () => {
      render(<PaymentsScreen payments={syntheticPayments} />);

      const providerSelect = screen.getByLabelText('Filtrar por provedor');
      fireEvent.change(providerSelect, { target: { value: 'husky' } });

      // Only Husky items should be visible
      expect(screen.getByText('Cliente Beta USD')).toBeInTheDocument();
      expect(screen.getByText('Cliente Emitido Adaflow')).toBeInTheDocument();
      expect(screen.queryByText('Cliente Alfa BRL')).not.toBeInTheDocument();

      // Reset filters button appears
      const resetButton = screen.getByRole('button', { name: 'Limpar todos os filtros' });
      fireEvent.click(resetButton);

      // Now Alfa is visible again
      expect(screen.getByText('Cliente Alfa BRL')).toBeInTheDocument();
    });
  });

  describe('Selection eligibility & accessible reasons', () => {
    it('allows only unambiguous received undeclared items to be selectable', () => {
      const eligibleBrl = syntheticPayments.find((p) => p.recordKey === 'pay_rec_undeclared_brl')!;
      const eligibleUsd = syntheticPayments.find((p) => p.recordKey === 'pay_rec_undeclared_usd')!;

      expect(getSelectionEligibility(eligibleBrl).selectable).toBe(true);
      expect(getSelectionEligibility(eligibleUsd).selectable).toBe(true);
    });

    it('disables pending payments with exact pt-BR reason', () => {
      const pending = syntheticPayments.find((p) => p.recordKey === 'pay_pending_brl')!;
      const eligibility = getSelectionEligibility(pending);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Pagamento ainda pendente de recebimento');
    });

    it('disables reverted payments with exact pt-BR reason', () => {
      const reverted = syntheticPayments.find((p) => p.recordKey === 'pay_reverted')!;
      const eligibility = getSelectionEligibility(reverted);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Pagamento revertido ou cancelado');
    });

    it('disables unknown state payments with exact pt-BR reason', () => {
      const unknown = syntheticPayments.find((p) => p.recordKey === 'pay_unknown')!;
      const eligibility = getSelectionEligibility(unknown);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Estado do pagamento desconhecido');
    });

    it('disables ambiguous identity payments with exact pt-BR reason', () => {
      const ambig = syntheticPayments.find((p) => p.recordKey === 'pay_rec_ambiguous')!;
      const eligibility = getSelectionEligibility(ambig);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Identidade ambígua - confirmação necessária');
    });

    it('disables already locally marked payments with exact pt-BR reason', () => {
      const local = syntheticPayments.find((p) => p.recordKey === 'pay_rec_local_marked')!;
      const eligibility = getSelectionEligibility(local);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Já marcado localmente');
    });

    it('disables already issued Adaflow payments with exact pt-BR reason', () => {
      const issued = syntheticPayments.find((p) => p.recordKey === 'pay_rec_issued_adaflow')!;
      const eligibility = getSelectionEligibility(issued);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('NFSe já emitida na Adaflow');
    });

    it('disables requested emission payments with exact pt-BR reason', () => {
      const req = syntheticPayments.find((p) => p.recordKey === 'pay_rec_solicitada')!;
      const eligibility = getSelectionEligibility(req);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Emissão em andamento');
    });

    it('allows failed emission payments to be selectable', () => {
      const failed = syntheticPayments.find((p) => p.recordKey === 'pay_rec_falha_adaflow')!;
      const eligibility = getSelectionEligibility(failed);
      expect(eligibility.selectable).toBe(true);
    });

    it('disables cancelled emission payments with exact pt-BR reason', () => {
      const cancelled = syntheticPayments.find((p) => p.recordKey === 'pay_rec_cancelada_adaflow')!;
      const eligibility = getSelectionEligibility(cancelled);
      expect(eligibility.selectable).toBe(false);
      expect(eligibility.reason).toBe('Declaração cancelada');
    });

    it('renders disabled checkboxes with accessible reasons in the UI', () => {
      render(<PaymentsScreen payments={syntheticPayments} />);

      // Eligible items have enabled checkboxes
      const eligibleCheckbox = screen.getByLabelText('Selecionar pagamento de Cliente Alfa BRL');
      expect(eligibleCheckbox).toBeEnabled();

      // Ineligible items have disabled checkboxes with reasons
      const pendingCheckbox = screen.getByLabelText(
        'Cliente Pendente: Pagamento ainda pendente de recebimento',
      );
      expect(pendingCheckbox).toBeDisabled();

      const ambigCheckbox = screen.getByLabelText(
        'Cliente Ambíguo: Identidade ambígua - confirmação necessária',
      );
      expect(ambigCheckbox).toBeDisabled();

      // Ambiguous indicator badge rendered
      expect(screen.getByText('Identidade ambígua - requer atenção')).toBeInTheDocument();

      // Reversal flagged badge rendered
      expect(screen.getByText('Reversão sinalizada para revisão')).toBeInTheDocument();
    });
  });

  describe('Multi-selection & Selection bar', () => {
    it('selects all eligible visible rows when select-all is clicked', () => {
      const onLocalMark = vi.fn();
      const onIssueAdaflow = vi.fn();

      render(
        <PaymentsScreen
          payments={syntheticPayments}
          onLocalMark={onLocalMark}
          onIssueAdaflow={onIssueAdaflow}
        />,
      );

      const selectAll = screen.getByRole('checkbox', {
        name: 'Selecionar todos os pagamentos elegíveis visíveis',
      });

      // There are 3 eligible rows: Alfa BRL, Beta USD, and Falha Adaflow
      expect(selectAll).not.toBeChecked();

      fireEvent.click(selectAll);
      expect(selectAll).toBeChecked();

      // Selection bar is displayed
      const selectionBar = screen.getByTestId('selection-bar');
      expect(within(selectionBar).getByText('3 pagamentos selecionados')).toBeInTheDocument();

      // Test "Marcar como emitida"
      const localMarkBtn = within(selectionBar).getByRole('button', {
        name: 'Marcar como emitida',
      });
      fireEvent.click(localMarkBtn);
      expect(onLocalMark).toHaveBeenCalledTimes(1);
      expect(onLocalMark).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ recordKey: 'pay_rec_undeclared_brl' }),
          expect.objectContaining({ recordKey: 'pay_rec_undeclared_usd' }),
          expect.objectContaining({ recordKey: 'pay_rec_falha_adaflow' }),
        ]),
      );

      // Test "Emitir pela Adaflow"
      const adaflowBtn = within(selectionBar).getByRole('button', {
        name: 'Emitir pela Adaflow',
      });
      fireEvent.click(adaflowBtn);
      expect(onIssueAdaflow).toHaveBeenCalledTimes(1);

      // Clicking select-all again deselects all
      fireEvent.click(selectAll);
      expect(selectAll).not.toBeChecked();
      expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    });

    it('toggles single row selection and shows singular text on selection bar', () => {
      render(<PaymentsScreen payments={syntheticPayments} />);

      const checkbox = screen.getByLabelText('Selecionar pagamento de Cliente Alfa BRL');
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      const selectionBar = screen.getByTestId('selection-bar');
      expect(within(selectionBar).getByText('1 pagamento selecionado')).toBeInTheDocument();

      // Deselect row
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    });

    it('prevents selection collision across different providers sharing the same recordKey', () => {
      const collisions: Payment[] = [
        {
          provider: 'asaas',
          recordKey: 'shared_key_123',
          sourcePaymentId: 'pay_a',
          identityConfidence: 'high',
          ambiguousIdentity: false,
          identityFingerprint: null,
          payerName: 'Cliente Asaas Compartilhado',
          amountCents: 10000,
          currency: 'BRL',
          paymentDate: '2026-11-10',
          sourceStatus: 'RECEIVED',
          paymentState: 'recebido',
          declarationState: 'nao_declarado',
          lastObservedAt: '2026-11-10T10:00:00Z',
          manualDeclaredAt: null,
        },
        {
          provider: 'husky',
          recordKey: 'shared_key_123',
          sourcePaymentId: 'pay_h',
          identityConfidence: 'high',
          ambiguousIdentity: false,
          identityFingerprint: null,
          payerName: 'Cliente Husky Compartilhado',
          amountCents: 20000,
          currency: 'BRL',
          paymentDate: '2026-11-10',
          sourceStatus: 'COMPLETED',
          paymentState: 'recebido',
          declarationState: 'nao_declarado',
          lastObservedAt: '2026-11-10T10:00:00Z',
          manualDeclaredAt: null,
        },
      ];

      render(<PaymentsScreen payments={collisions} />);

      const asaasCheckbox = screen.getByLabelText(
        'Selecionar pagamento de Cliente Asaas Compartilhado',
      );
      const huskyCheckbox = screen.getByLabelText(
        'Selecionar pagamento de Cliente Husky Compartilhado',
      );

      fireEvent.click(asaasCheckbox);
      expect(asaasCheckbox).toBeChecked();
      expect(huskyCheckbox).not.toBeChecked();

      const selectionBar = screen.getByTestId('selection-bar');
      expect(within(selectionBar).getByText('1 pagamento selecionado')).toBeInTheDocument();
    });
  });

  describe('Empty, Loading, and Scan Status Views', () => {
    it('renders pt-BR guidance when no payments exist', () => {
      render(<PaymentsScreen payments={[]} />);

      const emptyState = screen.getByTestId('empty-state-no-payments');
      expect(within(emptyState).getByText('Nenhum pagamento detectado')).toBeInTheDocument();
      expect(
        within(emptyState).getByText(/Acesse o portal do/i),
      ).toBeInTheDocument();
      expect(within(emptyState).getByText('Asaas')).toBeInTheDocument();
      expect(within(emptyState).getByText('Husky')).toBeInTheDocument();
    });

    it('renders filtered empty state when filter matches nothing', () => {
      render(<PaymentsScreen payments={syntheticPayments} />);

      const providerSelect = screen.getByLabelText('Filtrar por provedor');
      const stateSelect = screen.getByLabelText('Filtrar por estado do pagamento');

      // Select Husky + Revertidos (none exist in syntheticPayments)
      fireEvent.change(providerSelect, { target: { value: 'husky' } });
      fireEvent.change(stateSelect, { target: { value: 'revertido_ou_cancelado' } });

      expect(screen.getByTestId('empty-state-filtered')).toBeInTheDocument();
      expect(
        screen.getByText('Nenhum pagamento corresponde aos filtros selecionados.'),
      ).toBeInTheDocument();
    });

    it('renders loading state when isLoading is true', () => {
      render(<PaymentsScreen payments={[]} isLoading={true} />);

      expect(screen.getByText('Carregando pagamentos...')).toBeInTheDocument();
    });

    it('renders partial scan warning banner with pt-BR text', () => {
      render(
        <PaymentsScreen
          payments={syntheticPayments}
          scanStatus="partial"
          scanReason="Erro de conexão na página 3"
        />,
      );

      expect(screen.getByText('Sincronização parcial')).toBeInTheDocument();
      expect(screen.getByText('Erro de conexão na página 3')).toBeInTheDocument();
    });

    it('renders unsupported-origin view directing user to Asaas or Husky when on unsupported site', () => {
      // Scenario A: Unsupported origin with 0 payments
      const { unmount } = render(
        <PaymentsScreen payments={[]} sourceState="unsupported-origin" />,
      );

      const emptyView = screen.getByTestId('view-unsupported-origin');
      expect(within(emptyView).getByText('Origem não suportada')).toBeInTheDocument();
      expect(
        within(emptyView).getByText(/Abra o portal do/i),
      ).toBeInTheDocument();
      expect(within(emptyView).getByText('Asaas')).toBeInTheDocument();
      expect(within(emptyView).getByText('Husky')).toBeInTheDocument();
      unmount();

      // Scenario B: Unsupported origin with stored payments present (suppresses false alarm banner)
      render(
        <PaymentsScreen payments={syntheticPayments} sourceState="unsupported-origin" />,
      );

      expect(screen.queryByTestId('view-unsupported-origin')).not.toBeInTheDocument();
      // Stored payments are still listed
      expect(screen.getByText('Cliente Alfa BRL')).toBeInTheDocument();
    });

    it('renders source-unavailable view in pt-BR when portal connection fails or session expired', () => {
      render(
        <PaymentsScreen
          payments={syntheticPayments}
          sourceState="source-unavailable"
        />,
      );

      const unavailableBanner = screen.getByTestId('view-source-unavailable');
      expect(within(unavailableBanner).getByText('Portal indisponível')).toBeInTheDocument();
      expect(
        within(unavailableBanner).getByText(
          'Não foi possível conectar ao portal de pagamentos. Verifique se você está autenticado.',
        ),
      ).toBeInTheDocument();
    });

    it('renders custom source-unavailable message when provided', () => {
      render(
        <PaymentsScreen
          payments={syntheticPayments}
          sourceState="source-unavailable"
          sourceStateMessage="Sessão expirada no portal Asaas."
        />,
      );

      const unavailableBanner = screen.getByTestId('view-source-unavailable');
      expect(within(unavailableBanner).getByText('Portal indisponível')).toBeInTheDocument();
      expect(
        within(unavailableBanner).getByText('Sessão expirada no portal Asaas.'),
      ).toBeInTheDocument();
    });
  });

  describe('Helper formatters', () => {
    it('formats BRL and USD currencies correctly', () => {
      expect(formatCurrency(125050, 'BRL')).toMatch(/R\$\s*1\.250,50/);
      expect(formatCurrency(250000, 'USD')).toBe('$ 2,500.00');
      expect(formatCurrency(null)).toMatch(/R\$\s*0,00/);
    });

    it('formats dates in DD/MM/YYYY pt-BR format', () => {
      expect(formatDatePtBr('2026-11-15')).toBe('15/11/2026');
      expect(formatDatePtBr('2026-05-01T12:00:00Z')).toBe('01/05/2026');
      expect(formatDatePtBr(null)).toBe('Data não informada');
    });

    it('identifies supported vs unsupported portal URLs correctly', () => {
      expect(isSupportedPortalUrl('https://app.asaas.com/customerPayment/index')).toBe(true);
      expect(isSupportedPortalUrl('https://www.asaas.com')).toBe(true);
      expect(isSupportedPortalUrl('https://app.husky.io/transfers')).toBe(true);
      expect(isSupportedPortalUrl('https://husky.io/dashboard')).toBe(true);
      expect(isSupportedPortalUrl('http://localhost:3000')).toBe(true);

      expect(isSupportedPortalUrl('https://google.com')).toBe(false);
      expect(isSupportedPortalUrl('https://app.adaflow.com')).toBe(false);
      expect(isSupportedPortalUrl('invalid-url')).toBe(false);
      expect(isSupportedPortalUrl(undefined)).toBe(false);
    });
  });

  describe('Adaflow Real-time Sync & Reconciliation in PaymentsScreen', () => {
    it('renders active sync indicator when syncState indicates isSyncing', () => {
      render(
        <PaymentsScreen
          payments={syntheticPayments}
          syncState={{
            isSyncing: true,
            progressMessage: 'Escaneando página 1 de notas na Adaflow...',
            currentPage: 1,
            updatedAt: '2026-11-20T18:00:00.000Z',
          }}
        />,
      );

      expect(screen.getByTestId('reconciliation-sync-indicator')).toBeInTheDocument();
      expect(
        screen.getByText(/Sincronizando Adaflow: Escaneando página 1 de notas na Adaflow.../),
      ).toBeInTheDocument();
    });

    it('renders reconciliation audit card with unmatched warning alert in PaymentsScreen', () => {
      const now = new Date();
      now.setHours(15, 30, 0, 0);

      render(
        <PaymentsScreen
          payments={syntheticPayments}
          audit={{
            timestamp: now.toISOString(),
            declarationsFound: 2,
            matchedCount: 1,
            updatedCount: 1,
            alreadyDeclaredCount: 0,
            unmatchedCount: 1,
            details: [
              {
                asaasPaymentId: 'pay_1',
                nfseNumber: '65',
                adaflowNfseId: 1065,
                status: 'updated',
                requiresManualAction: false,
              },
              {
                asaasPaymentId: '891557',
                nfseNumber: '66',
                adaflowNfseId: 1066,
                date: '11/11/2026',
                takerName: 'Alpha Tech',
                description: 'Consultoria dev Asaas 891557',
                status: 'not_found',
                requiresManualAction: true,
              },
            ],
          }}
        />,
      );

      expect(screen.getByTestId('reconciliation-summary-card')).toBeInTheDocument();
      expect(screen.getByTestId('stat-matched')).toHaveTextContent('✅ 1 correspondências');
      expect(screen.getByTestId('audit-warning-box')).toBeInTheDocument();

      // Expand unmatched details
      fireEvent.click(screen.getByTestId('toggle-unmatched-details-btn'));
      expect(screen.getByTestId('unmatched-item-1066')).toBeInTheDocument();
      expect(screen.getByText('Tomador: Alpha Tech')).toBeInTheDocument();
      expect(screen.getByText('891557')).toBeInTheDocument();
    });
  });
});
