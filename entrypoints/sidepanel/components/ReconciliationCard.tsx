import React, { useEffect, useRef, useState } from 'react';
import type {
  AdaflowSyncState,
  ReconciliationAuditRecord,
} from '../../../src/services/adaflow-reconciliation';

export interface ReconciliationCardProps {
  syncState?: AdaflowSyncState | null;
  audit?: ReconciliationAuditRecord | null;
  onRefresh?: () => void;
  onManualMarkPayment?: (paymentId: string) => void;
  onDismissAuditWarning?: () => void;
}

export function formatReconciliationTime(isoString?: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    if (isToday) {
      return `Hoje às ${hours}:${minutes}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      return `Ontem às ${hours}:${minutes}`;
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month} às ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

export const ReconciliationCard: React.FC<ReconciliationCardProps> = ({
  syncState,
  audit,
  onRefresh,
  onManualMarkPayment,
  onDismissAuditWarning,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const isSyncing = Boolean(syncState?.isSyncing);

  if (!isSyncing && !audit) {
    return null;
  }

  const unmatchedNotes = audit?.details.filter(
    (d) => d.requiresManualAction || d.status === 'not_found',
  ) ?? [];

  const unmatchedCount = audit?.unmatchedCount ?? unmatchedNotes.length;
  const hasManualAction = unmatchedCount > 0 || unmatchedNotes.length > 0;

  const handleCopy = (
    note: NonNullable<ReconciliationAuditRecord['details']>[number],
    itemKey: string,
  ) => {
    const idText = note.asaasPaymentId
      ? `ID Asaas: ${note.asaasPaymentId}`
      : 'ID Asaas: (não identificado)';
    const nfseText = note.nfseNumber ? `NFSe: ${note.nfseNumber}` : `NFSe ID: ${note.adaflowNfseId}`;
    const descText = note.description ? `Descrição: ${note.description}` : '';
    const textToCopy = [idText, nfseText, descText].filter(Boolean).join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).catch(() => {});
    }

    setCopiedKey(itemKey);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedKey((curr) => (curr === itemKey ? null : curr));
      copyTimerRef.current = null;
    }, 2000);
  };

  return (
    <section className="reconciliation-container" data-testid="reconciliation-container">
      {/* Active Sync Progress Banner */}
      {isSyncing && (
        <div
          className="reconciliation-sync-pill"
          role="status"
          aria-live="polite"
          data-testid="reconciliation-sync-indicator"
        >
          <span className="sync-spinner" aria-hidden="true" />
          <span className="sync-message">
            🔄 Sincronizando Adaflow:{' '}
            {syncState?.progressMessage || 'Buscando notas fiscais emitidas...'}
          </span>
        </div>
      )}

      {/* Last Reconciliation Summary Card */}
      {audit && (
        <div className="reconciliation-card" data-testid="reconciliation-summary-card">
          <header className="reconciliation-header">
            <div className="reconciliation-title-group">
              <h4 className="reconciliation-title">Última Conciliação Adaflow</h4>
              <span className="reconciliation-timestamp" data-testid="reconciliation-timestamp">
                {formatReconciliationTime(audit.timestamp)}
              </span>
            </div>
            {onRefresh && (
              <button
                type="button"
                className="btn btn-link refresh-btn-sm"
                onClick={onRefresh}
                aria-label="Atualizar conciliação"
                data-testid="reconciliation-refresh-btn"
              >
                Atualizar
              </button>
            )}
          </header>

          <div className="reconciliation-stats" aria-label="Estatísticas de conciliação">
            <span
              className="reconciliation-stat-pill stat-matched"
              data-testid="stat-matched"
            >
              ✅ {audit.matchedCount} correspondências
            </span>
            <span
              className="reconciliation-stat-pill stat-updated"
              data-testid="stat-updated"
            >
              {audit.updatedCount} recém-marcadas
            </span>
            <span
              className="reconciliation-stat-pill stat-already"
              data-testid="stat-already"
            >
              {audit.alreadyDeclaredCount} já declaradas
            </span>
          </div>

          {/* Manual Action Alert */}
          {hasManualAction && !isDismissed && (
            <div
              className="audit-warning-box"
              role="alert"
              data-testid="audit-warning-box"
            >
              <div className="audit-warning-header">
                <div className="audit-warning-text-group">
                  <div className="audit-warning-title">
                    ⚠️ {unmatchedCount} nota(s) requerem atenção manual
                  </div>
                  <p className="audit-warning-desc">
                    Algumas notas emitidas na Adaflow não foram encontradas nos pagamentos do Asaas.
                  </p>
                </div>
                <div className="audit-warning-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setIsExpanded((prev) => !prev)}
                    aria-expanded={isExpanded}
                    data-testid="toggle-unmatched-details-btn"
                  >
                    {isExpanded ? 'Ocultar' : `Ver detalhes (${unmatchedCount})`}
                  </button>
                  {onDismissAuditWarning && (
                    <button
                      type="button"
                      className="btn-icon-dismiss"
                      onClick={() => {
                        setIsDismissed(true);
                        onDismissAuditWarning();
                      }}
                      aria-label="Dispensar aviso"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div
                  className="audit-unmatched-list"
                  data-testid="audit-unmatched-list"
                  role="region"
                  aria-label="Lista de notas que requerem atenção manual"
                >
                  {unmatchedNotes.map((note, idx) => {
                    const itemKey = `${note.adaflowNfseId}-${note.asaasPaymentId || idx}`;
                    const isCopied = copiedKey === itemKey;
                    const asaasIdDisplay = note.asaasPaymentId || '(não identificado)';

                    return (
                      <article
                        key={itemKey}
                        className="audit-unmatched-item"
                        data-testid={`unmatched-item-${note.adaflowNfseId}`}
                      >
                        <header className="unmatched-item-top">
                          <span className="unmatched-nfse-badge">
                            Nota {note.nfseNumber || note.adaflowNfseId}
                            {note.date ? ` • ${note.date}` : ''}
                          </span>
                          {note.takerName && (
                            <span className="unmatched-taker-name">
                              Tomador: {note.takerName}
                            </span>
                          )}
                        </header>

                        <div className="unmatched-item-body">
                          <div className="unmatched-field">
                            <span className="unmatched-field-label">ID Asaas extraído:</span>{' '}
                            <code className="unmatched-code">{asaasIdDisplay}</code>
                          </div>
                          {note.description && (
                            <div className="unmatched-field unmatched-desc">
                              <span className="unmatched-field-label">Descrição do serviço:</span>{' '}
                              <span>{note.description}</span>
                            </div>
                          )}
                          <div className="unmatched-field unmatched-reason">
                            <span className="unmatched-field-label">Motivo:</span>{' '}
                            <span>
                              {note.reason ||
                                'Cobrança Asaas não encontrada na base local de pagamentos.'}
                            </span>
                          </div>
                        </div>

                        <footer className="unmatched-item-actions">
                          <button
                            type="button"
                            className={`btn-copy-sm ${isCopied ? 'btn-copied' : ''}`}
                            onClick={() => handleCopy(note, itemKey)}
                            data-testid={`copy-btn-${note.adaflowNfseId}`}
                          >
                            {isCopied ? '✓ Copiado!' : 'Copiar ID/Descrição'}
                          </button>
                          {note.asaasPaymentId && onManualMarkPayment && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onManualMarkPayment(note.asaasPaymentId!)}
                            >
                              Marcar pagamento
                            </button>
                          )}
                        </footer>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default ReconciliationCard;
