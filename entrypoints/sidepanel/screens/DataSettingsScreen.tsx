import React, { useRef, useState } from 'react';
import {
  exportBackupJson,
  downloadBackupFile,
  parseAndValidateBackup,
  applyImport,
  clearAllData,
  type BackupPreview,
  type BackupEnvelope,
  type ImportMode,
} from '../../../src/services/backup';
import ImportPreview from '../components/ImportPreview';

export interface DataSettingsScreenProps {
  onDataChanged?: () => void | Promise<void>;
}

export const DataSettingsScreen: React.FC<DataSettingsScreenProps> = ({
  onDataChanged,
}) => {
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);

  const [importState, setImportState] = useState<{
    preview: BackupPreview;
    envelope?: BackupEnvelope;
  } | null>(null);

  // Danger zone state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setFeedback(null);
      const backup = await exportBackupJson();
      downloadBackupFile(backup);
      setFeedback({
        type: 'success',
        message: `Backup exportado com sucesso: ${backup.filename}`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Erro ao exportar backup: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReadingFile(true);
    setFeedback(null);

    try {
      const text = await file.text();
      const result = await parseAndValidateBackup(text);
      setImportState({
        preview: result.preview,
        envelope: result.envelope,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Erro ao ler arquivo: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsReadingFile(false);
      // Reset input value so same file can be re-selected if desired
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleApplyImport = async (mode: ImportMode) => {
    if (!importState?.envelope) return;

    try {
      setIsApplyingImport(true);
      setFeedback(null);
      const result = await applyImport(importState.envelope, mode);
      setFeedback({
        type: 'success',
        message: `Dados importados com sucesso (${mode === 'replace' ? 'Substituição' : 'Mesclagem'}): ${result.appliedCounts.payments} pagamentos, ${result.appliedCounts.takers} tomadores, ${result.appliedCounts.templates} modelos, ${result.appliedCounts.nfseOperations} operações.`,
      });
      setImportState(null);
      if (onDataChanged) {
        await onDataChanged();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Erro ao importar dados: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsApplyingImport(false);
    }
  };

  const handleCancelImport = () => {
    setImportState(null);
  };

  const handleStartDeleteAll = () => {
    setDeleteConfirmText('');
    setShowDeleteModal(true);
    setFeedback(null);
  };

  const handleCancelDeleteAll = () => {
    setShowDeleteModal(false);
    setDeleteConfirmText('');
  };

  const handleConfirmDeleteAll = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'EXCLUIR') return;

    try {
      setIsDeleting(true);
      await clearAllData();
      setShowDeleteModal(false);
      setDeleteConfirmText('');
      setFeedback({
        type: 'success',
        message:
          'Todos os dados locais foram excluídos com sucesso. O token da Adaflow não foi afetado.',
      });
      if (onDataChanged) {
        await onDataChanged();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Erro ao apagar dados: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="data-settings-container" data-testid="data-settings-screen">
      {feedback && (
        <div
          className={`settings-feedback settings-feedback-${feedback.type}`}
          role="status"
          data-testid="data-settings-feedback"
        >
          {feedback.message}
        </div>
      )}

      {/* Backup and Restore Section */}
      <div className="settings-card" data-testid="backup-restore-section">
        <div className="settings-card-header">
          <h3>Backup e Restauração</h3>
        </div>
        <p className="settings-description">
          Exporte seus pagamentos detectados, tomadores, modelos e operações locais em
          um arquivo JSON versionado ou restaure um backup existente. O token da
          Adaflow nunca é exportado.
        </p>

        <div className="backup-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={isExporting || isReadingFile || isApplyingImport}
            data-testid="export-backup-btn"
          >
            {isExporting ? 'Exportando...' : 'Exportar Dados (JSON)'}
          </button>

          <label
            className={`btn btn-secondary ${isReadingFile || isApplyingImport ? 'btn-disabled' : ''}`}
            data-testid="import-backup-btn"
          >
            {isReadingFile ? 'Lendo arquivo...' : 'Importar Dados (JSON)'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isReadingFile || isApplyingImport}
              data-testid="import-file-input"
            />
          </label>
        </div>

        {importState && (
          <div className="import-preview-wrapper" style={{ marginTop: 'var(--space-4)' }}>
            <ImportPreview
              preview={importState.preview}
              onConfirm={handleApplyImport}
              onCancel={handleCancelImport}
              isApplying={isApplyingImport}
            />
          </div>
        )}
      </div>

      {/* Danger Zone Section */}
      <div className="settings-card danger-card" data-testid="danger-zone-section">
        <div className="settings-card-header">
          <h3 className="danger-heading">Zona de Perigo / Exclusão de Dados</h3>
        </div>
        <p className="settings-description">
          Ações destrutivas sobre os dados locais armazenados no navegador.
        </p>

        {!showDeleteModal ? (
          <div>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleStartDeleteAll}
              data-testid="delete-all-data-btn"
            >
              Limpar Todos os Dados
            </button>
          </div>
        ) : (
          <div className="danger-modal-box" data-testid="delete-all-confirm-dialog">
            <div className="danger-box-title">Confirmar exclusão de dados</div>
            <p className="danger-box-text">
              Esta ação apagará permanentemente todos os pagamentos detectados,
              tomadores cadastrados, modelos de serviço e histórico de operações
              locais. O token da Adaflow não será afetado.
            </p>
            <p className="danger-box-prompt">
              Para prosseguir, digite <strong>EXCLUIR</strong> no campo abaixo:
            </p>
            <input
              type="text"
              className="form-input danger-confirm-input"
              placeholder="Digite EXCLUIR"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={isDeleting}
              data-testid="confirm-delete-phrase-input"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="danger-modal-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmDeleteAll}
                disabled={deleteConfirmText.trim().toUpperCase() !== 'EXCLUIR' || isDeleting}
                data-testid="confirm-delete-all-btn"
              >
                {isDeleting ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancelDeleteAll}
                disabled={isDeleting}
                data-testid="cancel-delete-all-btn"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataSettingsScreen;
