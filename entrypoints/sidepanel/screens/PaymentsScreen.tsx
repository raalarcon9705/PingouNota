import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Payment } from '../../../src/domain/payment';
import type { ScanStatus as ScanStatusType } from '../../../src/services/scan-coordinator';
import { listPayments } from '../../../src/storage/payment-repository';
import PaymentFilters, {
  filterPayments,
  initialFilterState,
  type FilterState,
} from '../components/PaymentFilters';
import PaymentRow, {
  formatCurrency,
  getSelectionEligibility,
} from '../components/PaymentRow';
import ScanStatus, { type PortalSourceState } from '../components/ScanStatus';
export type { PortalSourceState };

export interface PaymentSummary {
  receivedCount: number;
  pendingCount: number;
  revertedCount: number;
  unknownCount: number;
  totalCount: number;
  receivedTotalBrlCents: number;
  pendingTotalBrlCents: number;
}

export function calculatePaymentSummary(payments: Payment[]): PaymentSummary {
  let receivedCount = 0;
  let pendingCount = 0;
  let revertedCount = 0;
  let unknownCount = 0;
  let receivedTotalBrlCents = 0;
  let pendingTotalBrlCents = 0;

  for (const payment of payments) {
    if (payment.paymentState === 'recebido') {
      receivedCount++;
      if (payment.amountCents && (payment.currency === 'BRL' || !payment.currency)) {
        receivedTotalBrlCents += payment.amountCents;
      }
    } else if (payment.paymentState === 'aguardando_recebimento') {
      pendingCount++;
      if (payment.amountCents && (payment.currency === 'BRL' || !payment.currency)) {
        pendingTotalBrlCents += payment.amountCents;
      }
    } else if (payment.paymentState === 'revertido_ou_cancelado') {
      revertedCount++;
    } else {
      unknownCount++;
    }
  }

  return {
    receivedCount,
    pendingCount,
    revertedCount,
    unknownCount,
    totalCount: payments.length,
    receivedTotalBrlCents,
    pendingTotalBrlCents,
  };
}

export function sortPayments(payments: Payment[]): Payment[] {
  return [...payments].sort((a, b) => {
    const aIsReceivedUndeclared =
      a.paymentState === 'recebido' && a.declarationState === 'nao_declarado';
    const bIsReceivedUndeclared =
      b.paymentState === 'recebido' && b.declarationState === 'nao_declarado';

    if (aIsReceivedUndeclared && !bIsReceivedUndeclared) return -1;
    if (!aIsReceivedUndeclared && bIsReceivedUndeclared) return 1;

    const dateA = a.paymentDate || a.lastObservedAt || '';
    const dateB = b.paymentDate || b.lastObservedAt || '';
    return dateB.localeCompare(dateA);
  });
}

export interface PaymentsScreenProps {
  payments?: Payment[];
  isLoading?: boolean;
  sourceState?: PortalSourceState;
  sourceStateMessage?: string | null;
  scanStatus?: ScanStatusType;
  scanReason?: string | null;
  pagesSeen?: number;
  recordsFound?: number;
  onLocalMark?: (selected: Payment[]) => void;
  onIssueAdaflow?: (selected: Payment[]) => void;
  onRefresh?: () => void;
}

export const PaymentsScreen: React.FC<PaymentsScreenProps> = ({
  payments: controlledPayments,
  isLoading: controlledLoading,
  sourceState = 'supported',
  sourceStateMessage = null,
  scanStatus = 'idle',
  scanReason = null,
  pagesSeen = 0,
  recordsFound = 0,
  onLocalMark,
  onIssueAdaflow,
  onRefresh,
}) => {
  const [internalPayments, setInternalPayments] = useState<Payment[]>([]);
  const [internalLoading, setInternalLoading] = useState<boolean>(
    controlledPayments === undefined,
  );
  const [filters, setFilters] = useState<FilterState>(initialFilterState);
  const [selectedRecordKeys, setSelectedRecordKeys] = useState<Set<string>>(new Set());

  const selectAllRef = useRef<HTMLInputElement>(null);

  const isControlled = controlledPayments !== undefined;
  const rawPayments = isControlled ? controlledPayments : internalPayments;
  const isLoading =
    controlledLoading !== undefined ? controlledLoading : internalLoading;

  useEffect(() => {
    if (!isControlled) {
      let isMounted = true;
      setInternalLoading(true);
      listPayments()
        .then((items) => {
          if (isMounted) {
            setInternalPayments(items);
            setInternalLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) {
            setInternalLoading(false);
          }
        });
      return () => {
        isMounted = false;
      };
    }
  }, [isControlled]);

  const summary = useMemo(() => calculatePaymentSummary(rawPayments), [rawPayments]);

  const sortedPayments = useMemo(() => sortPayments(rawPayments), [rawPayments]);

  const filteredPayments = useMemo(
    () => filterPayments(sortedPayments, filters),
    [sortedPayments, filters],
  );

  const selectableVisiblePayments = useMemo(
    () => filteredPayments.filter((p) => getSelectionEligibility(p).selectable),
    [filteredPayments],
  );

  const isAllSelectableSelected =
    selectableVisiblePayments.length > 0 &&
    selectableVisiblePayments.every((p) => selectedRecordKeys.has(p.recordKey));

  const isSomeSelectableSelected = selectableVisiblePayments.some((p) =>
    selectedRecordKeys.has(p.recordKey),
  );

  const isIndeterminate =
    isSomeSelectableSelected && !isAllSelectableSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    setSelectedRecordKeys((prev) => {
      const next = new Set(prev);
      if (isAllSelectableSelected) {
        for (const p of selectableVisiblePayments) {
          next.delete(p.recordKey);
        }
      } else {
        for (const p of selectableVisiblePayments) {
          next.add(p.recordKey);
        }
      }
      return next;
    });
  };

  const handleToggleSelectRow = (recordKey: string) => {
    setSelectedRecordKeys((prev) => {
      const next = new Set(prev);
      if (next.has(recordKey)) {
        next.delete(recordKey);
      } else {
        next.add(recordKey);
      }
      return next;
    });
  };

  const selectedPayments = useMemo(
    () => rawPayments.filter((p) => selectedRecordKeys.has(p.recordKey)),
    [rawPayments, selectedRecordKeys],
  );

  return (
    <div className="payments-screen" data-testid="payments-screen">
      <ScanStatus
        status={scanStatus}
        reason={scanReason}
        pagesSeen={pagesSeen}
        recordsFound={recordsFound}
        sourceState={rawPayments.length === 0 && sourceState === 'unsupported-origin' ? undefined : sourceState}
        sourceStateMessage={sourceStateMessage}
      />

      {/* Summary Cards */}
      <section className="summary-grid" aria-label="Resumo dos pagamentos">
        <article className="summary-card summary-received" data-testid="summary-received">
          <span className="summary-label">Recebidos</span>
          <span className="summary-count" data-testid="summary-received-count">
            {summary.receivedCount}
          </span>
          <span className="summary-amount" data-testid="summary-received-amount">
            {formatCurrency(summary.receivedTotalBrlCents, 'BRL')}
          </span>
        </article>

        <article className="summary-card summary-pending" data-testid="summary-pending">
          <span className="summary-label">Pendentes</span>
          <span className="summary-count" data-testid="summary-pending-count">
            {summary.pendingCount}
          </span>
          <span className="summary-amount" data-testid="summary-pending-amount">
            {formatCurrency(summary.pendingTotalBrlCents, 'BRL')}
          </span>
        </article>
      </section>

      {/* Filters */}
      <PaymentFilters filters={filters} onChange={setFilters} disabled={isLoading} />

      {/* Loading state */}
      {isLoading && (
        <div className="loading-state" role="status" aria-live="polite">
          <p>Carregando pagamentos...</p>
        </div>
      )}

      {/* Empty State: No payments detected at all */}
      {!isLoading && rawPayments.length === 0 && (
        sourceState === 'unsupported-origin' ? (
          <div
            className="empty-state unsupported-origin-state"
            role="region"
            aria-label="Origem não suportada"
            data-testid="view-unsupported-origin"
          >
            <h3>Origem não suportada</h3>
            <p>
              Abra o portal do <strong>Asaas</strong> (asaas.com) ou da <strong>Husky</strong> (husky.io) para detectar e conciliar seus pagamentos.
            </p>
            <p className="empty-hint">
              O PingouNota funciona sincronizando pagamentos diretamente dos portais financeiros suportados.
            </p>
          </div>
        ) : (
          <div
            className="empty-state"
            role="region"
            aria-label="Nenhum pagamento detectado"
            data-testid="empty-state-no-payments"
          >
            <h3>Nenhum pagamento detectado</h3>
            <p>
              Acesse o portal do <strong>Asaas</strong> ou <strong>Husky</strong> em
              uma aba do navegador para sincronizar e gerenciar seus recebimentos.
            </p>
            <p className="empty-hint">
              O PingouNota detecta automaticamente novos pagamentos quando você acessa
              o histórico financeiro nesses portais.
            </p>
          </div>
        )
      )}

      {/* Empty Filtered State: Payments exist, but none match filters */}
      {!isLoading && rawPayments.length > 0 && filteredPayments.length === 0 && (
        <div
          className="empty-filtered-state"
          role="region"
          aria-label="Nenhum pagamento corresponde aos filtros"
          data-testid="empty-state-filtered"
        >
          <h3>Nenhum pagamento encontrado</h3>
          <p>Nenhum pagamento corresponde aos filtros selecionados.</p>
        </div>
      )}

      {/* Payments List */}
      {!isLoading && filteredPayments.length > 0 && (
        <section className="payments-list-section" aria-label="Lista de pagamentos">
          <header className="payments-list-header">
            <div className="select-all-cell">
              <input
                ref={selectAllRef}
                type="checkbox"
                id="select-all-payments"
                checked={isAllSelectableSelected}
                disabled={selectableVisiblePayments.length === 0}
                onChange={handleToggleSelectAll}
                aria-label="Selecionar todos os pagamentos elegíveis visíveis"
                className="select-all-checkbox"
              />
              <label htmlFor="select-all-payments" className="select-all-label">
                Selecionar todos ({selectableVisiblePayments.length} elegíveis)
              </label>
            </div>
            <div className="list-meta-info">
              <span>
                Exibindo {filteredPayments.length} de {rawPayments.length}
              </span>
              {onRefresh && (
                <button
                  type="button"
                  className="btn btn-link refresh-btn"
                  onClick={onRefresh}
                  aria-label="Atualizar pagamentos"
                >
                  Atualizar
                </button>
              )}
            </div>
          </header>

          <div className="payments-list" role="feed" aria-label="Itens de pagamento">
            {filteredPayments.map((payment) => (
              <PaymentRow
                key={`${payment.provider}-${payment.recordKey}`}
                payment={payment}
                isSelected={selectedRecordKeys.has(payment.recordKey)}
                onToggleSelect={handleToggleSelectRow}
              />
            ))}
          </div>
        </section>
      )}

      {/* Selection action bar */}
      {selectedRecordKeys.size > 0 && (
        <aside
          className="selection-bar"
          role="region"
          aria-label="Ações de seleção"
          data-testid="selection-bar"
        >
          <div className="selection-bar-info">
            <span className="selection-count">
              {selectedRecordKeys.size}{' '}
              {selectedRecordKeys.size === 1
                ? 'pagamento selecionado'
                : 'pagamentos selecionados'}
            </span>
          </div>
          <div className="selection-bar-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onLocalMark?.(selectedPayments)}
              aria-label="Marcar como emitida"
            >
              Marcar como emitida
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onIssueAdaflow?.(selectedPayments)}
              aria-label="Emitir pela Adaflow"
            >
              Emitir pela Adaflow
            </button>
          </div>
        </aside>
      )}
    </div>
  );
};

export default PaymentsScreen;
