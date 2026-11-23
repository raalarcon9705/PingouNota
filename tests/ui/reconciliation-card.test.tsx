import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReconciliationCard, {
  formatReconciliationTime,
} from '../../entrypoints/sidepanel/components/ReconciliationCard';
import type {
  AdaflowSyncState,
  ReconciliationAuditRecord,
} from '../../src/services/adaflow-reconciliation';

describe('ReconciliationCard (Apple HIG)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatReconciliationTime', () => {
    it('formats today timestamps as "Hoje às HH:mm"', () => {
      const now = new Date();
      now.setHours(15, 2, 0, 0);
      const formatted = formatReconciliationTime(now.toISOString());
      expect(formatted).toBe('Hoje às 15:02');
    });

    it('formats yesterday timestamps as "Ontem às HH:mm"', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(9, 30, 0, 0);
      const formatted = formatReconciliationTime(yesterday.toISOString());
      expect(formatted).toBe('Ontem às 09:30');
    });

    it('returns empty string for undefined input', () => {
      expect(formatReconciliationTime(undefined)).toBe('');
    });
  });

  it('renders nothing when not syncing and no audit is provided', () => {
    const { container } = render(<ReconciliationCard syncState={null} audit={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders active sync indicator when syncState.isSyncing is true', () => {
    const syncState: AdaflowSyncState = {
      isSyncing: true,
      progressMessage: 'Escaneando página 2 de notas na Adaflow...',
      currentPage: 2,
      updatedAt: new Date().toISOString(),
    };

    render(<ReconciliationCard syncState={syncState} audit={null} />);

    expect(screen.getByTestId('reconciliation-sync-indicator')).toBeInTheDocument();
    expect(
      screen.getByText(/Sincronizando Adaflow: Escaneando página 2 de notas na Adaflow.../),
    ).toBeInTheDocument();
  });

  it('renders last reconciliation summary with stats and relative time', () => {
    const now = new Date();
    now.setHours(14, 20, 0, 0);

    const audit: ReconciliationAuditRecord = {
      timestamp: now.toISOString(),
      declarationsFound: 5,
      matchedCount: 4,
      updatedCount: 3,
      alreadyDeclaredCount: 1,
      unmatchedCount: 0,
      details: [
        {
          asaasPaymentId: 'pay_101',
          nfseNumber: '101',
          adaflowNfseId: 501,
          date: '15/10/2026',
          status: 'updated',
          requiresManualAction: false,
        },
      ],
    };

    render(<ReconciliationCard audit={audit} />);

    expect(screen.getByTestId('reconciliation-summary-card')).toBeInTheDocument();
    expect(screen.getByText('Última Conciliação Adaflow')).toBeInTheDocument();
    expect(screen.getByTestId('reconciliation-timestamp')).toHaveTextContent('Hoje às 14:20');

    expect(screen.getByTestId('stat-matched')).toHaveTextContent('✅ 4 correspondências');
    expect(screen.getByTestId('stat-updated')).toHaveTextContent('3 recém-marcadas');
    expect(screen.getByTestId('stat-already')).toHaveTextContent('1 já declaradas');

    // No warning alert should appear when unmatchedCount is 0
    expect(screen.queryByTestId('audit-warning-box')).not.toBeInTheDocument();
  });

  it('renders manual action alert and displays unmatched note details on expand', async () => {
    const audit: ReconciliationAuditRecord = {
      timestamp: new Date().toISOString(),
      declarationsFound: 3,
      matchedCount: 1,
      updatedCount: 1,
      alreadyDeclaredCount: 0,
      unmatchedCount: 2,
      details: [
        {
          asaasPaymentId: 'pay_1',
          nfseNumber: '65',
          adaflowNfseId: 1065,
          date: '10/11/2026',
          status: 'updated',
          requiresManualAction: false,
        },
        {
          asaasPaymentId: '891557',
          nfseNumber: '66',
          adaflowNfseId: 1066,
          date: '11/11/2026',
          takerName: 'Empresa Alpha Ltda',
          description: 'Desenvolvimento de software referente a cobranca Asaas 891557',
          status: 'not_found',
          requiresManualAction: true,
          reason: 'Cobrança Asaas não encontrada na base local de pagamentos.',
        },
        {
          asaasPaymentId: '',
          nfseNumber: '67',
          adaflowNfseId: 1067,
          date: '12/11/2026',
          takerName: 'Empresa Beta S/A',
          description: 'Consultoria e mentoria avulsa',
          status: 'not_found',
          requiresManualAction: true,
        },
      ],
    };

    render(<ReconciliationCard audit={audit} />);

    // Warning alert visible
    const warningBox = screen.getByTestId('audit-warning-box');
    expect(warningBox).toBeInTheDocument();
    expect(
      screen.getByText('⚠️ 2 nota(s) requerem atenção manual'),
    ).toBeInTheDocument();

    const toggleBtn = screen.getByTestId('toggle-unmatched-details-btn');
    expect(toggleBtn).toHaveTextContent('Ver detalhes (2)');

    // Initially collapsed
    expect(screen.queryByTestId('audit-unmatched-list')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('Ocultar');
    expect(screen.getByTestId('audit-unmatched-list')).toBeInTheDocument();

    // Check item 66 details
    const item66 = screen.getByTestId('unmatched-item-1066');
    expect(item66).toBeInTheDocument();
    expect(item66).toHaveTextContent('Nota 66 • 11/11/2026');
    expect(item66).toHaveTextContent('Tomador: Empresa Alpha Ltda');
    expect(item66).toHaveTextContent('ID Asaas (da descrição): 891557');
    expect(item66).toHaveTextContent(
      'Descrição do serviço: Desenvolvimento de software referente a cobranca Asaas 891557',
    );
    expect(item66).toHaveTextContent(
      'Motivo: Cobrança Asaas não encontrada na base local de pagamentos.',
    );

    // Check item 67 details (unidentified Asaas ID)
    const item67 = screen.getByTestId('unmatched-item-1067');
    expect(item67).toBeInTheDocument();
    expect(item67).toHaveTextContent('Nota 67 • 12/11/2026');
    expect(item67).toHaveTextContent('Tomador: Empresa Beta S/A');
    expect(item67).toHaveTextContent('ID Asaas (da descrição): (não identificado)');
    expect(item67).toHaveTextContent('Descrição do serviço: Consultoria e mentoria avulsa');
    expect(item67).toHaveTextContent(
      'Motivo: Cobrança Asaas não encontrada na base local de pagamentos.',
    );
  });

  it('copies note info to clipboard and provides visual feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const audit: ReconciliationAuditRecord = {
      timestamp: new Date().toISOString(),
      declarationsFound: 1,
      matchedCount: 0,
      updatedCount: 0,
      alreadyDeclaredCount: 0,
      unmatchedCount: 1,
      details: [
        {
          asaasPaymentId: '891557',
          nfseNumber: '66',
          adaflowNfseId: 1066,
          date: '11/11/2026',
          description: 'Serviço de teste',
          status: 'not_found',
          requiresManualAction: true,
        },
      ],
    };

    render(<ReconciliationCard audit={audit} />);

    // Expand details
    fireEvent.click(screen.getByTestId('toggle-unmatched-details-btn'));

    const copyBtn = screen.getByTestId('copy-btn-1066');
    expect(copyBtn).toHaveTextContent('Copiar ID/Descrição');

    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('ID Asaas (da descrição): 891557'),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('NFSe: 66'),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('Descrição: Serviço de teste'),
    );

    expect(copyBtn).toHaveTextContent('✓ Copiado!');
  });

  it('supports refresh action button when onRefresh callback is supplied', () => {
    const onRefresh = vi.fn();
    const audit: ReconciliationAuditRecord = {
      timestamp: new Date().toISOString(),
      declarationsFound: 1,
      matchedCount: 1,
      updatedCount: 1,
      alreadyDeclaredCount: 0,
      unmatchedCount: 0,
      details: [],
    };

    render(<ReconciliationCard audit={audit} onRefresh={onRefresh} />);

    const refreshBtn = screen.getByTestId('reconciliation-refresh-btn');
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('dismisses warning alert when onDismissAuditWarning is invoked', () => {
    const onDismiss = vi.fn();
    const audit: ReconciliationAuditRecord = {
      timestamp: new Date().toISOString(),
      declarationsFound: 1,
      matchedCount: 0,
      updatedCount: 0,
      alreadyDeclaredCount: 0,
      unmatchedCount: 1,
      details: [
        {
          asaasPaymentId: '891557',
          adaflowNfseId: 1066,
          status: 'not_found',
          requiresManualAction: true,
        },
      ],
    };

    render(<ReconciliationCard audit={audit} onDismissAuditWarning={onDismiss} />);

    expect(screen.getByTestId('audit-warning-box')).toBeInTheDocument();

    const dismissBtn = screen.getByLabelText('Dispensar aviso');
    fireEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('audit-warning-box')).not.toBeInTheDocument();
  });
});
