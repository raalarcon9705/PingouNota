import React, { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { Payment } from '../../../src/domain/payment';
import type { ServiceTemplate } from '../../../src/domain/template';
import { isValidBrazilianDocument, type TakerProfile } from '../../../src/domain/taker';
import type { NfseOperation } from '../../../src/domain/nfse-operation';
import { listTemplates, renderTemplateDescription } from '../../../src/services/templates';
import { listTakers } from '../../../src/services/takers';
import { buildNfseIssuePayload } from '../../../src/services/adaflow/emission-queue';
import { db, type PingouNotaDB } from '../../../src/storage/database';
import IssueReviewRow from '../components/IssueReviewRow';
import { formatCurrency } from '../components/PaymentRow';

export interface RowDraftState {
  templateId: string;
  takerId: string;
  description: string;
  withholdTaxes: boolean;
  forwardingEmail: string;
  isCustomDescription?: boolean;
}

export function validateReviewRow(
  payment: Payment,
  template?: ServiceTemplate,
  taker?: TakerProfile,
  description?: string,
  forwardingEmail?: string,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!taker) {
    errors.push('Selecione um tomador de serviço.');
  } else {
    const isBrazil = !taker.address?.country || taker.address.country.toUpperCase() === 'BR';
    if (isBrazil) {
      if (!taker.document || !isValidBrazilianDocument(taker.document)) {
        errors.push('Tomador brasileiro sem CPF/CNPJ válido.');
      }
    }
  }

  if (!template) {
    errors.push('Selecione um modelo de serviço.');
  } else if (!template.cnae || !template.cnae.trim()) {
    errors.push('O modelo de serviço deve ter um CNAE válido.');
  }

  if (!description || !description.trim()) {
    errors.push('A descrição do serviço é obrigatória.');
  }

  if (payment.amountCents == null || payment.amountCents <= 0) {
    errors.push('Valor do pagamento deve ser positivo.');
  }

  const rawCurr = (payment.currency || 'BRL').trim().toUpperCase();
  const supported = ['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'];
  if (!supported.includes(rawCurr)) {
    errors.push(`Moeda "${payment.currency}" não suportada para emissão Adaflow.`);
  }

  if (forwardingEmail && forwardingEmail.trim().length > 0) {
    const emailTest = z.string().email().safeParse(forwardingEmail.trim());
    if (!emailTest.success) {
      errors.push('E-mail de encaminhamento inválido.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export interface IssueReviewScreenProps {
  payments: Payment[];
  onCancel: () => void;
  onConfirmed?: (operationIds: string[]) => void;
  dbInstance?: PingouNotaDB;
}

export const IssueReviewScreen: React.FC<IssueReviewScreenProps> = ({
  payments,
  onCancel,
  onConfirmed,
  dbInstance,
}) => {
  const targetDb = dbInstance ?? db;

  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [takers, setTakers] = useState<TakerProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [defaultTemplateId, setDefaultTemplateId] = useState<string>('');
  const [defaultTakerId, setDefaultTakerId] = useState<string>('');

  const [rowsState, setRowsState] = useState<Record<string, RowDraftState>>({});

  useEffect(() => {
    let isMounted = true;
    Promise.all([listTemplates(targetDb), listTakers(targetDb)])
      .then(([tmplList, takerList]) => {
        if (!isMounted) return;
        setTemplates(tmplList);
        setTakers(takerList);

        const initialTmplId = tmplList[0]?.id || '';
        const initialTakerId = takerList[0]?.id || '';
        setDefaultTemplateId(initialTmplId);
        setDefaultTakerId(initialTakerId);

        const initialRows: Record<string, RowDraftState> = {};
        const tmplObj = tmplList[0];

        for (const p of payments) {
          const key = `${p.provider}:${p.recordKey}`;
          initialRows[key] = {
            templateId: initialTmplId,
            takerId: initialTakerId,
            description: tmplObj
              ? renderTemplateDescription(tmplObj.description, p.paymentDate)
              : '',
            withholdTaxes: tmplObj ? tmplObj.withholdTaxes : false,
            forwardingEmail: tmplObj?.forwardingEmail || '',
            isCustomDescription: false,
          };
        }

        setRowsState(initialRows);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[PingouNota] Erro ao carregar templates/takers para revisão:', err);
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [payments, targetDb]);

  const handleDefaultTemplateChange = (newTemplateId: string) => {
    setDefaultTemplateId(newTemplateId);
    const newTmpl = templates.find((t) => t.id === newTemplateId);

    setRowsState((prev) => {
      const updated = { ...prev };
      for (const p of payments) {
        const key = `${p.provider}:${p.recordKey}`;
        const current = updated[key];
        if (current) {
          updated[key] = {
            ...current,
            templateId: newTemplateId,
            description:
              newTmpl && !current.isCustomDescription
                ? renderTemplateDescription(newTmpl.description, p.paymentDate)
                : current.description,
            withholdTaxes: newTmpl ? newTmpl.withholdTaxes : current.withholdTaxes,
            forwardingEmail: newTmpl?.forwardingEmail || current.forwardingEmail,
          };
        }
      }
      return updated;
    });
  };

  const handleDefaultTakerChange = (newTakerId: string) => {
    setDefaultTakerId(newTakerId);
    setRowsState((prev) => {
      const updated = { ...prev };
      for (const p of payments) {
        const key = `${p.provider}:${p.recordKey}`;
        const current = updated[key];
        if (current) {
          updated[key] = {
            ...current,
            takerId: newTakerId,
          };
        }
      }
      return updated;
    });
  };

  const handleRowFieldChange = <K extends keyof RowDraftState>(
    compositeKey: string,
    field: K,
    value: RowDraftState[K],
  ) => {
    setRowsState((prev) => {
      const current = prev[compositeKey];
      if (!current) return prev;
      return {
        ...prev,
        [compositeKey]: {
          ...current,
          [field]: value,
          ...(field === 'description' ? { isCustomDescription: true } : {}),
        },
      };
    });
  };

  // Compute row validations
  const rowValidations = useMemo(() => {
    const validations: Record<string, { isValid: boolean; errors: string[] }> = {};
    for (const p of payments) {
      const key = `${p.provider}:${p.recordKey}`;
      const state = rowsState[key];
      const template = templates.find((t) => t.id === state?.templateId);
      const taker = takers.find((t) => t.id === state?.takerId);
      validations[key] = validateReviewRow(
        p,
        template,
        taker,
        state?.description,
        state?.forwardingEmail,
      );
    }
    return validations;
  }, [payments, rowsState, templates, takers]);

  const validRows = useMemo(() => {
    return payments.filter((p) => {
      const key = `${p.provider}:${p.recordKey}`;
      return rowValidations[key]?.isValid;
    });
  }, [payments, rowValidations]);

  const totalBrlCents = useMemo(() => {
    let sum = 0;
    for (const p of validRows) {
      if (p.amountCents && (p.currency === 'BRL' || !p.currency)) {
        sum += p.amountCents;
      }
    }
    return sum;
  }, [validRows]);

  const handleConfirmAndEnqueue = async () => {
    if (validRows.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const operationIds: string[] = [];

      for (const p of validRows) {
        const key = `${p.provider}:${p.recordKey}`;
        const row = rowsState[key]!;
        const template = templates.find((t) => t.id === row.templateId)!;
        const taker = takers.find((t) => t.id === row.takerId)!;

        const operationId = crypto.randomUUID();
        const idempotencyKey = crypto.randomUUID();
        const externalId = `${p.provider}_${p.recordKey}_${operationId}`;

        const payload = buildNfseIssuePayload(
          p,
          template,
          taker,
          row.description,
          externalId,
          {
            withholdTaxes: row.withholdTaxes,
            forwardingEmail: row.forwardingEmail,
          },
        );

        const operation: NfseOperation = {
          id: operationId,
          provider: p.provider,
          paymentRecordKey: p.recordKey,
          externalId,
          idempotencyKey,
          payloadJson: JSON.stringify(payload),
          adaflowNfseId: null,
          status: 'queued',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await targetDb.nfseOperations.put(operation);

        await targetDb.payments.update([p.provider, p.recordKey], {
          declarationState: 'emissao_solicitada',
          linkedNfseOperationId: operationId,
        });

        operationIds.push(operationId);
      }

      // Notify background queue
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'ISSUE_QUEUE_START',
            operationIds,
          });
        }
      } catch {
        // Disconnected runtime in unit tests or background not ready
      }

      onConfirmed?.(operationIds);
    } catch (error) {
      console.error('[PingouNota] Falha ao enfileirar emissão de NFSes:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="review-loading" data-testid="review-loading">
        <p>Carregando dados de modelos e tomadores...</p>
      </div>
    );
  }

  return (
    <div
      className="issue-review-screen"
      data-testid="issue-review-screen"
      role="region"
      aria-label="Revisão de Emissão de Notas"
    >
      <header className="review-header">
        <div className="review-header-title">
          <h2>Revisão antes da Emissão</h2>
          <p>
            Verifique e ajuste os dados de cada nota fiscal antes de enviar para a fila da Adaflow.
          </p>
        </div>

        {/* Global Default Selectors */}
        <div className="review-global-selectors">
          <div className="form-group">
            <label htmlFor="default-template-select">Modelo padrão para todos:</label>
            <select
              id="default-template-select"
              aria-label="Modelo padrão para todos"
              value={defaultTemplateId}
              onChange={(e) => handleDefaultTemplateChange(e.target.value)}
              className="input-select"
            >
              <option value="">Selecione um modelo padrão...</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="default-taker-select">Tomador padrão para todos:</label>
            <select
              id="default-taker-select"
              aria-label="Tomador padrão para todos"
              value={defaultTakerId}
              onChange={(e) => handleDefaultTakerChange(e.target.value)}
              className="input-select"
            >
              <option value="">Selecione um tomador padrão...</option>
              {takers.map((taker) => (
                <option key={taker.id} value={taker.id}>
                  {taker.name} {taker.document ? `(${taker.document})` : '(Sem doc)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Summary Box */}
      <section className="review-summary-box" aria-label="Resumo da emissão">
        <div className="summary-stat">
          <span className="summary-label">Notas a emitir:</span>
          <span className="summary-value" data-testid="summary-count">
            {validRows.length} de {payments.length} válidas
          </span>
        </div>
        {totalBrlCents > 0 && (
          <div className="summary-stat">
            <span className="summary-label">Total BRL:</span>
            <span className="summary-value" data-testid="summary-total-brl">
              {formatCurrency(totalBrlCents, 'BRL')}
            </span>
          </div>
        )}
        {validRows.length < payments.length && (
          <div className="summary-alert">
            <span>
              {payments.length - validRows.length} item(s) com erros serão ignorados até serem corrigidos.
            </span>
          </div>
        )}
      </section>

      {/* Rows Feed */}
      <div className="review-rows-list" role="feed" aria-label="Lista de notas em revisão">
        {payments.map((payment) => {
          const key = `${payment.provider}:${payment.recordKey}`;
          const row = rowsState[key] || {
            templateId: defaultTemplateId,
            takerId: defaultTakerId,
            description: '',
            withholdTaxes: false,
            forwardingEmail: '',
          };
          const validation = rowValidations[key] || { isValid: false, errors: [] };

          return (
            <IssueReviewRow
              key={key}
              payment={payment}
              templates={templates}
              takers={takers}
              selectedTemplateId={row.templateId}
              selectedTakerId={row.takerId}
              description={row.description}
              withholdTaxes={row.withholdTaxes}
              forwardingEmail={row.forwardingEmail}
              validationErrors={validation.errors}
              isValid={validation.isValid}
              onTemplateChange={(tmplId) => {
                const tmpl = templates.find((t) => t.id === tmplId);
                handleRowFieldChange(key, 'templateId', tmplId);
                if (tmpl && !row.isCustomDescription) {
                  handleRowFieldChange(
                    key,
                    'description',
                    renderTemplateDescription(tmpl.description, payment.paymentDate),
                  );
                }
                if (tmpl) {
                  handleRowFieldChange(key, 'withholdTaxes', tmpl.withholdTaxes);
                  if (tmpl.forwardingEmail) {
                    handleRowFieldChange(key, 'forwardingEmail', tmpl.forwardingEmail);
                  }
                }
              }}
              onTakerChange={(takerId) => handleRowFieldChange(key, 'takerId', takerId)}
              onDescriptionChange={(desc) => handleRowFieldChange(key, 'description', desc)}
              onWithholdTaxesChange={(withhold) =>
                handleRowFieldChange(key, 'withholdTaxes', withhold)
              }
              onForwardingEmailChange={(email) =>
                handleRowFieldChange(key, 'forwardingEmail', email)
              }
            />
          );
        })}
      </div>

      {/* Review Actions Footer */}
      <footer className="review-footer-bar">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={isSubmitting}
          onClick={onCancel}
          aria-label="Cancelar"
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={validRows.length === 0 || isSubmitting}
          onClick={handleConfirmAndEnqueue}
          aria-label="Confirmar e Enviar para Fila"
        >
          {isSubmitting
            ? 'Enviando para Fila...'
            : `Confirmar e Enviar para Fila (${validRows.length})`}
        </button>
      </footer>
    </div>
  );
};

export default IssueReviewScreen;
