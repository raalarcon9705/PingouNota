import React, { useState } from 'react';
import type { BackupPreview, ImportMode } from '../../../src/services/backup';

export interface ImportPreviewProps {
  preview: BackupPreview;
  onConfirm: (mode: ImportMode) => Promise<void> | void;
  onCancel: () => void;
  isApplying?: boolean;
}

export const ImportPreview: React.FC<ImportPreviewProps> = ({
  preview,
  onConfirm,
  onCancel,
  isApplying = false,
}) => {
  const [selectedMode, setSelectedMode] = useState<ImportMode>('merge');

  const formattedDate = (() => {
    if (!preview.exportedAt) return 'Data desconhecida';
    try {
      const date = new Date(preview.exportedAt);
      if (isNaN(date.getTime())) return preview.exportedAt;
      return date.toLocaleString('pt-BR');
    } catch {
      return preview.exportedAt;
    }
  })();

  const handleConfirm = () => {
    if (!preview.isValid || isApplying) return;
    onConfirm(selectedMode);
  };

  return (
    <div className="import-preview-container" data-testid="import-preview">
      <div className="import-preview-header">
        <h3>Pré-visualização do Backup</h3>
        <p className="import-preview-subtitle">
          Revise os dados contidos no arquivo antes de confirmar a importação no banco
          local.
        </p>
      </div>

      {!preview.isValid && (
        <div
          className="import-error-banner"
          role="alert"
          data-testid="import-validation-errors"
        >
          <div className="import-error-title">Arquivo de backup inválido</div>
          <p>
            O arquivo fornecido não atende aos requisitos do esquema ou está
            corrompido. Nenhuma alteração foi realizada no seu banco de dados.
          </p>
          <ul className="import-error-list">
            {preview.validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="import-meta-card">
        <div className="meta-item">
          <span className="meta-label">Data de exportação:</span>
          <span className="meta-value" data-testid="preview-export-date">
            {formattedDate}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Versão do esquema:</span>
          <span className="meta-value" data-testid="preview-schema-version">
            v{preview.schemaVersion}
          </span>
        </div>
      </div>

      <div className="import-stats-table-wrapper">
        <table className="import-stats-table" data-testid="import-stats-table">
          <thead>
            <tr>
              <th>Entidade</th>
              <th>No Arquivo</th>
              <th>Já no Banco (Duplicados)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pagamentos</td>
              <td data-testid="count-payments">{preview.counts.payments}</td>
              <td data-testid="duplicates-payments">{preview.duplicates.payments}</td>
            </tr>
            <tr>
              <td>Tomadores de Serviço</td>
              <td data-testid="count-takers">{preview.counts.takers}</td>
              <td data-testid="duplicates-takers">{preview.duplicates.takers}</td>
            </tr>
            <tr>
              <td>Modelos de Serviço</td>
              <td data-testid="count-templates">{preview.counts.templates}</td>
              <td data-testid="duplicates-templates">{preview.duplicates.templates}</td>
            </tr>
            <tr>
              <td>Operações NFSe</td>
              <td data-testid="count-operations">{preview.counts.nfseOperations}</td>
              <td data-testid="duplicates-operations">
                {preview.duplicates.nfseOperations}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {preview.isValid && (
        <div className="import-mode-section">
          <h4>Modo de Importação</h4>
          <div className="mode-options" role="radiogroup" aria-label="Modo de importação">
            <label
              className={`mode-option-card ${selectedMode === 'merge' ? 'mode-option-selected' : ''}`}
            >
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={selectedMode === 'merge'}
                onChange={() => setSelectedMode('merge')}
                disabled={isApplying}
                data-testid="mode-merge-radio"
              />
              <div className="mode-option-content">
                <strong>Mesclar dados (Merge)</strong>
                <p>
                  Adiciona novos registros e atualiza existentes mantendo outros dados
                  intactos.
                </p>
              </div>
            </label>

            <label
              className={`mode-option-card ${selectedMode === 'replace' ? 'mode-option-selected' : ''}`}
            >
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={selectedMode === 'replace'}
                onChange={() => setSelectedMode('replace')}
                disabled={isApplying}
                data-testid="mode-replace-radio"
              />
              <div className="mode-option-content">
                <strong>Substituir tudo (Replace)</strong>
                <p>
                  Substitui todo o banco de dados pelos registros deste backup.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      <div className="import-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isApplying}
          data-testid="cancel-import-btn"
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfirm}
          disabled={!preview.isValid || isApplying}
          data-testid="confirm-import-btn"
        >
          {isApplying ? 'Importando...' : 'Confirmar Importação'}
        </button>
      </div>
    </div>
  );
};

export default ImportPreview;
