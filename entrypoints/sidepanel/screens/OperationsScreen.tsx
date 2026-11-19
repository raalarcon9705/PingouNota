import React, { useCallback, useEffect, useState } from 'react';
import type { NfseOperation } from '../../../src/domain/nfse-operation';
import type { Payment } from '../../../src/domain/payment';
import { db, type PingouNotaDB } from '../../../src/storage/database';
import { formatCurrency, formatDatePtBr } from '../components/PaymentRow';

export interface OperationsScreenProps {
  onNavigatePayments?: () => void;
  dbInstance?: PingouNotaDB;
}

export const OperationsScreen: React.FC<OperationsScreenProps> = ({
  onNavigatePayments,
  dbInstance,
}) => {
  const targetDb = dbInstance ?? db;
  const [operations, setOperations] = useState<NfseOperation[]>([]);
  const [paymentsMap, setPaymentsMap] = useState<Map<string, Payment>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadOperations = useCallback(async () => {
    try {
      const ops = await targetDb.nfseOperations.toArray();
      // Sort newest first
      ops.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setOperations(ops);

      const pMap = new Map<string, Payment>();
      for (const op of ops) {
        const key = `${op.provider}:${op.paymentRecordKey}`;
        if (!pMap.has(key)) {
          const payment = await targetDb.payments.get([op.provider, op.paymentRecordKey]);
          if (payment) {
            pMap.set(key, payment);
          }
        }
      }
      setPaymentsMap(pMap);
    } catch (err) {
      console.error('[PingouNota] Erro ao carregar operações de emissão:', err);
    } finally {
      setIsLoading(false);
    }
  }, [targetDb]);

  useEffect(() => {
    loadOperations();

    const handleMessage = (msg: unknown) => {
      if (
        msg &&
        typeof msg === 'object' &&
        'type' in msg &&
        (msg as { type: string }).type === 'ISSUE_QUEUE_PROGRESS'
      ) {
        loadOperations();
      }
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(handleMessage);
      }
    } catch {
      // Disconnected or non-extension environment
    }

    return () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
          chrome.runtime.onMessage.removeListener(handleMessage);
        }
      } catch {
        // Disconnected or non-extension environment
      }
    };
  }, [loadOperations]);

  const getStatusBadge = (status: NfseOperation['status']) => {
    switch (status) {
      case 'queued':
        return <span className="op-badge op-badge-queued">Na Fila</span>;
      case 'requested':
        return <span className="op-badge op-badge-requested">Solicitada</span>;
      case 'issued':
        return <span className="op-badge op-badge-issued">Emitida</span>;
      case 'failed':
        return <span className="op-badge op-badge-failed">Falha</span>;
      case 'cancelled':
        return <span className="op-badge op-badge-cancelled">Cancelada</span>;
      default:
        return <span className="op-badge">{status}</span>;
    }
  };

  return (
    <div
      className="operations-screen"
      data-testid="operations-screen"
      role="region"
      aria-label="Operações de Emissão de NFSe"
    >
      <header className="operations-header">
        <div>
          <h2>Operações de NFSe</h2>
          <p>Acompanhe o status das emissões e o processamento na fila da Adaflow.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={loadOperations}
          aria-label="Atualizar operações"
        >
          Atualizar
        </button>
      </header>

      {isLoading && (
        <div className="operations-loading" data-testid="operations-loading">
          <p>Carregando operações...</p>
        </div>
      )}

      {!isLoading && operations.length === 0 && (
        <div
          className="empty-state"
          data-testid="empty-operations"
          role="region"
          aria-label="Nenhuma operação registrada"
        >
          <h3>Nenhuma operação registrada</h3>
          <p>
            Você ainda não enviou notas para emissão. Selecione pagamentos recebidos na aba
            de Pagamentos e clique em &ldquo;Emitir pela Adaflow&rdquo;.
          </p>
          {onNavigatePayments && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNavigatePayments}
            >
              Ir para Pagamentos
            </button>
          )}
        </div>
      )}

      {!isLoading && operations.length > 0 && (
        <div className="operations-list" role="feed" aria-label="Histórico de operações">
          {operations.map((op) => {
            const paymentKey = `${op.provider}:${op.paymentRecordKey}`;
            const payment = paymentsMap.get(paymentKey);

            return (
              <article
                key={op.id}
                className={`operation-card operation-card-${op.status}`}
                data-testid={`operation-item-${op.id}`}
                aria-label={`Operação ${op.externalId} status ${op.status}`}
              >
                <header className="operation-card-header">
                  <div className="operation-card-title">
                    <span className="badge-provider badge-provider-small">
                      {op.provider.toUpperCase()}
                    </span>
                    <h4>{payment?.payerName || 'Pagador não identificado'}</h4>
                  </div>
                  <div className="operation-card-status">
                    {getStatusBadge(op.status)}
                  </div>
                </header>

                <div className="operation-card-meta">
                  {payment && (
                    <div className="meta-item">
                      <span className="meta-label">Valor:</span>
                      <strong className="meta-value">
                        {formatCurrency(payment.amountCents, payment.currency)}
                      </strong>
                    </div>
                  )}

                  {payment?.paymentDate && (
                    <div className="meta-item">
                      <span className="meta-label">Data do Pagamento:</span>
                      <span className="meta-value">
                        {formatDatePtBr(payment.paymentDate)}
                      </span>
                    </div>
                  )}

                  <div className="meta-item">
                    <span className="meta-label">ID Externo:</span>
                    <span className="meta-value code-snippet">{op.externalId}</span>
                  </div>

                  {op.adaflowNfseId != null && (
                    <div className="meta-item">
                      <span className="meta-label">ID Adaflow:</span>
                      <span className="meta-value code-snippet">#{op.adaflowNfseId}</span>
                    </div>
                  )}

                  <div className="meta-item">
                    <span className="meta-label">Criada em:</span>
                    <span className="meta-value">
                      {new Date(op.createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-label">Atualizada em:</span>
                    <span className="meta-value">
                      {new Date(op.updatedAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>

                {/* Error Banner for failed operations */}
                {op.status === 'failed' && op.errorMessage && (
                  <div
                    className="operation-error-banner"
                    data-testid="operation-error-display"
                    role="alert"
                  >
                    <span className="error-icon" aria-hidden="true">
                      ⚠️
                    </span>
                    <div className="error-text">
                      <strong>Falha na emissão:</strong> {op.errorMessage}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OperationsScreen;
