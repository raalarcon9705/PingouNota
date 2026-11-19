import React, { useState } from 'react';
import type { Payment } from '../../../src/domain/payment';
import { markPaymentLocally } from '../../../src/domain/declaration';
import { db, type PingouNotaDB } from '../../../src/storage/database';
import { formatCurrency, formatDatePtBr } from './PaymentRow';

export interface LocalMarkDialogProps {
  isOpen: boolean;
  payments: Payment[];
  onClose: () => void;
  onSuccess?: (count: number) => void;
  dbInstance?: PingouNotaDB;
}

export const VERBATIM_DISCLAIMER =
  'Esta ação atualiza apenas o registro local da extensão. Ela não emite uma NFSe nem consulta notas emitidas na Adaflow.';

export const LocalMarkDialog: React.FC<LocalMarkDialogProps> = ({
  isOpen,
  payments,
  onClose,
  onSuccess,
  dbInstance = db,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completionCount, setCompletionCount] = useState<number | null>(null);

  if (!isOpen) return null;

  const totalAmountCents = payments.reduce(
    (sum, p) => sum + (p.amountCents || 0),
    0,
  );

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const now = new Date().toISOString();
      const targetDb = dbInstance;

      // Mark locally using domain logic - absolutely NO calls to Adaflow or external APIs
      const updatedPayments = payments.map((payment) =>
        markPaymentLocally(payment, now),
      );

      // Persist all marked records directly into Dexie
      await targetDb.transaction('rw', targetDb.payments, async () => {
        for (const payment of updatedPayments) {
          await targetDb.payments.put(payment);
        }
      });

      setCompletionCount(updatedPayments.length);
      onSuccess?.(updatedPayments.length);
    } catch (err) {
      console.error('[PingouNota] Erro ao marcar localmente:', err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Erro ao marcar pagamentos localmente.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    setCompletionCount(null);
    onClose();
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          if (completionCount !== null) handleFinish();
          else onClose();
        }
      }}
    >
      <div
        className="dialog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-mark-dialog-title"
        aria-describedby="local-mark-dialog-disclaimer"
        data-testid="local-mark-dialog"
      >
        <header className="dialog-header">
          <h2 id="local-mark-dialog-title">Marcar como emitida localmente</h2>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={completionCount !== null ? handleFinish : onClose}
            aria-label="Fechar modal"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </header>

        <div className="dialog-body">
          {completionCount !== null ? (
            <div
              className="dialog-success-message"
              data-testid="completion-summary"
            >
              <div className="success-icon" aria-hidden="true">
                ✓
              </div>
              <h3>Marcação concluída com sucesso</h3>
              <p>
                {completionCount === 1
                  ? '1 pagamento foi marcado como emitido localmente.'
                  : `${completionCount} pagamentos foram marcados como emitidos localmente.`}
              </p>
            </div>
          ) : (
            <>
              {/* Verbatim Disclaimer requirement */}
              <div
                id="local-mark-dialog-disclaimer"
                className="dialog-disclaimer"
                role="note"
                data-testid="local-mark-disclaimer"
              >
                <div className="disclaimer-icon" aria-hidden="true">
                  ℹ
                </div>
                <p className="disclaimer-text">{VERBATIM_DISCLAIMER}</p>
              </div>

              {errorMessage && (
                <div className="dialog-error-banner" role="alert">
                  {errorMessage}
                </div>
              )}

              <section className="dialog-summary" aria-label="Resumo da seleção">
                <div className="summary-row">
                  <span className="summary-label">Quantidade:</span>
                  <span className="summary-value" data-testid="summary-count">
                    {payments.length}{' '}
                    {payments.length === 1 ? 'pagamento' : 'pagamentos'}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Valor total estimado:</span>
                  <span className="summary-value summary-amount">
                    {formatCurrency(totalAmountCents, payments[0]?.currency || 'BRL')}
                  </span>
                </div>
              </section>

              <div
                className="dialog-payments-list"
                role="list"
                aria-label="Pagamentos selecionados"
              >
                {payments.map((p) => (
                  <div
                    key={`${p.provider}-${p.recordKey}`}
                    className="dialog-payment-item"
                    role="listitem"
                  >
                    <div className="dialog-payment-main">
                      <span className="dialog-payment-payer">
                        {p.payerName || 'Pagador não identificado'}
                      </span>
                      <span className="dialog-payment-date">
                        {formatDatePtBr(p.paymentDate || p.lastObservedAt)}
                      </span>
                    </div>
                    <div className="dialog-payment-side">
                      <span className="dialog-payment-amount">
                        {formatCurrency(p.amountCents, p.currency)}
                      </span>
                      <span className="provider-badge">
                        {p.provider === 'asaas' ? 'Asaas' : 'Husky'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="dialog-footer">
          {completionCount !== null ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleFinish}
              data-testid="btn-finish-marking"
            >
              Concluir
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={isSubmitting}
                data-testid="btn-cancel-marking"
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={isSubmitting || payments.length === 0}
                data-testid="btn-confirm-marking"
              >
                {isSubmitting ? 'Marcando...' : 'Confirmar marcação'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

export default LocalMarkDialog;
