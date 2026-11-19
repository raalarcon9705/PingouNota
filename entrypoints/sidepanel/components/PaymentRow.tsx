import React from 'react';
import type { DeclarationState, Payment } from '../../../src/domain/payment';

export interface SelectionEligibility {
  selectable: boolean;
  reason?: string;
}

export function getSelectionEligibility(payment: Payment): SelectionEligibility {
  if (payment.paymentState === 'aguardando_recebimento') {
    return { selectable: false, reason: 'Pagamento ainda pendente de recebimento' };
  }
  if (payment.paymentState === 'revertido_ou_cancelado') {
    return { selectable: false, reason: 'Pagamento revertido ou cancelado' };
  }
  if (payment.paymentState === 'desconhecido') {
    return { selectable: false, reason: 'Estado do pagamento desconhecido' };
  }
  if (payment.ambiguousIdentity) {
    return { selectable: false, reason: 'Identidade ambígua - confirmação necessária' };
  }
  if (payment.declarationState === 'marcado_localmente') {
    return { selectable: false, reason: 'Já marcado localmente' };
  }
  if (payment.declarationState === 'emitida_adaflow') {
    return { selectable: false, reason: 'NFSe já emitida na Adaflow' };
  }
  if (payment.declarationState === 'emissao_solicitada') {
    return { selectable: false, reason: 'Emissão em andamento' };
  }
  if (payment.declarationState === 'falha_adaflow') {
    return { selectable: false, reason: 'Emissão anterior falhou - verificar detalhes' };
  }
  if (payment.declarationState === 'cancelada_adaflow') {
    return { selectable: false, reason: 'Declaração cancelada' };
  }
  if (
    payment.paymentState === 'recebido' &&
    payment.declarationState === 'nao_declarado' &&
    !payment.ambiguousIdentity
  ) {
    return { selectable: true };
  }
  return { selectable: false, reason: 'Não elegível para seleção' };
}

export function formatCurrency(
  cents: number | null | undefined,
  currency: string | null | undefined = 'BRL',
): string {
  if (cents == null) return 'R$ 0,00';
  const val = cents / 100;
  const curr = (currency || 'BRL').toUpperCase();

  if (curr === 'USD') {
    return `$ ${val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: curr,
    })
      .format(val)
      .replace(/\u00a0/g, ' ');
  } catch {
    return `${curr} ${val.toFixed(2)}`;
  }
}

export function formatDatePtBr(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Data não informada';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
}

export function getDeclarationStateLabel(state: DeclarationState): string {
  switch (state) {
    case 'nao_declarado':
      return 'Não declarado';
    case 'marcado_localmente':
      return 'Marcado localmente';
    case 'emissao_solicitada':
      return 'Emissão solicitada';
    case 'emitida_adaflow':
      return 'Emitida Adaflow';
    case 'falha_adaflow':
      return 'Falha Adaflow';
    case 'cancelada_adaflow':
      return 'Cancelada Adaflow';
    default:
      return state;
  }
}

export interface PaymentRowProps {
  payment: Payment;
  isSelected: boolean;
  onToggleSelect: (compositeKey: string) => void;
}

export const PaymentRow: React.FC<PaymentRowProps> = ({
  payment,
  isSelected,
  onToggleSelect,
}) => {
  const compositeKey = `${payment.provider}:${payment.recordKey}`;
  const eligibility = getSelectionEligibility(payment);
  const payer = payment.payerName || 'Pagador não identificado';
  const formattedAmount = formatCurrency(payment.amountCents, payment.currency);
  const formattedDate = formatDatePtBr(payment.paymentDate || payment.lastObservedAt);
  const providerLabel = payment.provider === 'asaas' ? 'Asaas' : 'Husky';
  const declarationLabel = getDeclarationStateLabel(payment.declarationState);

  const checkboxId = `checkbox-${payment.provider}-${payment.recordKey}`;
  const checkboxAriaLabel = eligibility.selectable
    ? `Selecionar pagamento de ${payer}`
    : `${payer}: ${eligibility.reason}`;

  return (
    <article
      className={`payment-row ${isSelected ? 'payment-row-selected' : ''} ${!eligibility.selectable ? 'payment-row-disabled' : ''}`}
      data-testid={`payment-row-${payment.recordKey}`}
      aria-label={`Pagamento de ${payer}`}
    >
      <div className="payment-select-cell">
        <input
          type="checkbox"
          id={checkboxId}
          checked={isSelected}
          disabled={!eligibility.selectable}
          onChange={() => onToggleSelect(compositeKey)}
          title={eligibility.reason}
          aria-label={checkboxAriaLabel}
          className="payment-checkbox"
        />
      </div>

      <div className="payment-main-cell">
        <div className="payment-primary-line">
          <span className="payment-payer" title={payer}>
            {payer}
          </span>
          <span className="payment-amount" aria-label={`Valor: ${formattedAmount}`}>
            {formattedAmount}
          </span>
        </div>

        <div className="payment-secondary-line">
          <span className="payment-date" aria-label={`Data: ${formattedDate}`}>
            {formattedDate}
          </span>
          <div className="payment-badges">
            <span
              className={`badge badge-provider badge-${payment.provider}`}
              aria-label={`Provedor: ${providerLabel}`}
            >
              {providerLabel}
            </span>
            <span
              className="badge badge-source-status"
              aria-label={`Status de origem: ${payment.sourceStatus}`}
            >
              {payment.sourceStatus}
            </span>
            <span
              className={`badge badge-declaration badge-decl-${payment.declarationState}`}
              aria-label={`Declaração: ${declarationLabel}`}
            >
              {declarationLabel}
            </span>
          </div>
        </div>

        {payment.ambiguousIdentity && (
          <div className="payment-alert-line">
            <span
              className="badge badge-warning badge-ambiguous"
              role="status"
              aria-label="Identidade ambígua - requer atenção"
            >
              Identidade ambígua - requer atenção
            </span>
          </div>
        )}

        {payment.reversalFlaggedForReview && (
          <div className="payment-alert-line">
            <span
              className="badge badge-reversal"
              role="alert"
              aria-label="Reversão sinalizada para revisão"
            >
              Reversão sinalizada para revisão
            </span>
          </div>
        )}

        {!eligibility.selectable && eligibility.reason && (
          <div className="payment-unselectable-line">
            <span
              className="unselectable-reason"
              title={eligibility.reason}
              aria-label={`Motivo da desabilitação: ${eligibility.reason}`}
            >
              {eligibility.reason}
            </span>
          </div>
        )}
      </div>
    </article>
  );
};

export default PaymentRow;
