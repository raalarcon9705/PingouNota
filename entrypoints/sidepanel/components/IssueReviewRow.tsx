import React from 'react';
import type { Payment } from '../../../src/domain/payment';
import type { ServiceTemplate } from '../../../src/domain/template';
import type { TakerProfile } from '../../../src/domain/taker';
import { formatCurrency } from './PaymentRow';

export interface IssueReviewRowProps {
  payment: Payment;
  templates: ServiceTemplate[];
  takers: TakerProfile[];
  selectedTemplateId: string;
  selectedTakerId: string;
  description: string;
  withholdTaxes: boolean;
  forwardingEmail: string;
  validationErrors: string[];
  isValid: boolean;
  onTemplateChange: (templateId: string) => void;
  onTakerChange: (takerId: string) => void;
  onDescriptionChange: (description: string) => void;
  onWithholdTaxesChange: (withhold: boolean) => void;
  onForwardingEmailChange: (email: string) => void;
}

export const IssueReviewRow: React.FC<IssueReviewRowProps> = ({
  payment,
  templates,
  takers,
  selectedTemplateId,
  selectedTakerId,
  description,
  withholdTaxes,
  forwardingEmail,
  validationErrors,
  isValid,
  onTemplateChange,
  onTakerChange,
  onDescriptionChange,
  onWithholdTaxesChange,
  onForwardingEmailChange,
}) => {
  const selectedTaker = takers.find((t) => t.id === selectedTakerId);
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <article
      className={`issue-review-row ${!isValid ? 'issue-review-row-invalid' : ''}`}
      data-testid={`issue-review-row-${payment.provider}-${payment.recordKey}`}
      aria-label={`Revisão de emissão para ${payment.payerName || payment.recordKey}`}
    >
      <header className="review-row-header">
        <div className="review-row-title-area">
          <span className="badge-provider badge-provider-small">
            {payment.provider.toUpperCase()}
          </span>
          <h4 className="review-payer-name">
            {payment.payerName || 'Pagador não identificado'}
          </h4>
        </div>
        <div className="review-row-header-aside">
          <span className="review-payment-amount">
            {formatCurrency(payment.amountCents, payment.currency)}
          </span>
          {!isValid && (
            <span
              className="review-badge-warning"
              data-testid="warning-badge"
              aria-label="Item com erro de validação"
            >
              Inválido
            </span>
          )}
        </div>
      </header>

      {/* Validation Errors Alert */}
      {!isValid && validationErrors.length > 0 && (
        <div
          className="review-validation-errors"
          role="alert"
          data-testid="inline-validation-errors"
        >
          <span className="error-title">Corrija os problemas antes de emitir:</span>
          <ul className="error-list">
            {validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="review-row-form-grid">
        {/* Tomador */}
        <div className="form-group">
          <label htmlFor={`taker-${payment.provider}-${payment.recordKey}`}>
            Tomador do Serviço
          </label>
          <select
            id={`taker-${payment.provider}-${payment.recordKey}`}
            aria-label="Tomador"
            value={selectedTakerId}
            onChange={(e) => onTakerChange(e.target.value)}
            className="input-select"
          >
            <option value="">Selecione um tomador...</option>
            {takers.map((taker) => (
              <option key={taker.id} value={taker.id}>
                {taker.name} {taker.document ? `(${taker.document})` : '(Sem documento)'}
              </option>
            ))}
          </select>
          <div className="review-field-meta">
            <span>
              Documento: <strong>{selectedTaker?.document || 'Nenhum'}</strong>
            </span>
          </div>
        </div>

        {/* Modelo de Serviço */}
        <div className="form-group">
          <label htmlFor={`template-${payment.provider}-${payment.recordKey}`}>
            Modelo de Serviço
          </label>
          <select
            id={`template-${payment.provider}-${payment.recordKey}`}
            aria-label="Modelo de Serviço"
            value={selectedTemplateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            className="input-select"
          >
            <option value="">Selecione um modelo...</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
          <div className="review-field-meta">
            <span>
              CNAE: <strong>{selectedTemplate?.cnae || 'Nenhum'}</strong>
            </span>
          </div>
        </div>

        {/* Descrição do Serviço */}
        <div className="form-group form-group-full">
          <label htmlFor={`desc-${payment.provider}-${payment.recordKey}`}>
            Descrição na Nota
          </label>
          <textarea
            id={`desc-${payment.provider}-${payment.recordKey}`}
            aria-label="Descrição do serviço"
            rows={3}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="input-textarea"
            placeholder="Descrição detalhada do serviço prestado..."
          />
        </div>

        {/* E-mail de Encaminhamento */}
        <div className="form-group">
          <label htmlFor={`email-${payment.provider}-${payment.recordKey}`}>
            E-mail de Encaminhamento
          </label>
          <input
            id={`email-${payment.provider}-${payment.recordKey}`}
            type="email"
            aria-label="E-mail de encaminhamento"
            value={forwardingEmail}
            onChange={(e) => onForwardingEmailChange(e.target.value)}
            className="input-text"
            placeholder="financeiro@empresa.com"
          />
        </div>

        {/* Retenção de Impostos */}
        <div className="form-group form-group-checkbox">
          <label className="checkbox-label">
            <input
              type="checkbox"
              aria-label="Reter impostos"
              checked={withholdTaxes}
              onChange={(e) => onWithholdTaxesChange(e.target.checked)}
            />
            <span>Reter impostos na fonte</span>
          </label>
        </div>
      </div>
    </article>
  );
};

export default IssueReviewRow;
