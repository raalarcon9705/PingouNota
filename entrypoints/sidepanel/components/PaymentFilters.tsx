import React from 'react';
import type {
  DeclarationState,
  Payment,
  PaymentProvider,
  PaymentState,
} from '../../../src/domain/payment';

export interface FilterState {
  provider: 'all' | PaymentProvider;
  paymentState: 'all' | PaymentState;
  declarationState: 'all' | DeclarationState;
}

export const initialFilterState: FilterState = {
  provider: 'all',
  paymentState: 'all',
  declarationState: 'all',
};

export function filterPayments(payments: Payment[], filters: FilterState): Payment[] {
  return payments.filter((payment) => {
    if (filters.provider !== 'all' && payment.provider !== filters.provider) {
      return false;
    }
    if (filters.paymentState !== 'all' && payment.paymentState !== filters.paymentState) {
      return false;
    }
    if (
      filters.declarationState !== 'all' &&
      payment.declarationState !== filters.declarationState
    ) {
      return false;
    }
    return true;
  });
}

export interface PaymentFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  disabled?: boolean;
}

export const PaymentFilters: React.FC<PaymentFiltersProps> = ({
  filters,
  onChange,
  disabled = false,
}) => {
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...filters,
      provider: e.target.value as FilterState['provider'],
    });
  };

  const handlePaymentStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...filters,
      paymentState: e.target.value as FilterState['paymentState'],
    });
  };

  const handleDeclarationStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...filters,
      declarationState: e.target.value as FilterState['declarationState'],
    });
  };

  const hasActiveFilters =
    filters.provider !== 'all' ||
    filters.paymentState !== 'all' ||
    filters.declarationState !== 'all';

  const handleReset = () => {
    onChange(initialFilterState);
  };

  return (
    <div className="filters-card" role="search" aria-label="Filtros de pagamentos">
      <div className="filters-grid">
        <div className="filter-group">
          <label htmlFor="filter-provider">Provedor</label>
          <select
            id="filter-provider"
            value={filters.provider}
            onChange={handleProviderChange}
            disabled={disabled}
            aria-label="Filtrar por provedor"
          >
            <option value="all">Todos</option>
            <option value="asaas">Asaas</option>
            <option value="husky">Husky</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-payment-state">Estado</label>
          <select
            id="filter-payment-state"
            value={filters.paymentState}
            onChange={handlePaymentStateChange}
            disabled={disabled}
            aria-label="Filtrar por estado do pagamento"
          >
            <option value="all">Todos</option>
            <option value="recebido">Recebidos</option>
            <option value="aguardando_recebimento">Pendentes</option>
            <option value="revertido_ou_cancelado">Revertidos/Cancelados</option>
            <option value="desconhecido">Desconhecido</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-declaration-state">Declaração</label>
          <select
            id="filter-declaration-state"
            value={filters.declarationState}
            onChange={handleDeclarationStateChange}
            disabled={disabled}
            aria-label="Filtrar por estado de declaração"
          >
            <option value="all">Todos</option>
            <option value="nao_declarado">Não declarado</option>
            <option value="marcado_localmente">Marcado localmente</option>
            <option value="emissao_solicitada">Emissão solicitada</option>
            <option value="emitida_adaflow">Emitida Adaflow</option>
            <option value="falha_adaflow">Falha Adaflow</option>
            <option value="cancelada_adaflow">Cancelada Adaflow</option>
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="filter-reset-row">
          <button
            type="button"
            className="btn btn-link"
            onClick={handleReset}
            disabled={disabled}
            aria-label="Limpar todos os filtros"
          >
            Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
};

export default PaymentFilters;
