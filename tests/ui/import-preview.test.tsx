import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportPreview from '../../entrypoints/sidepanel/components/ImportPreview';
import DataSettingsScreen from '../../entrypoints/sidepanel/screens/DataSettingsScreen';
import { createDatabase, PingouNotaDB } from '../../src/storage/database';
import type { BackupPreview } from '../../src/services/backup';
import * as backupService from '../../src/services/backup';
import { _resetMemoryTokenForTesting, saveAdaflowToken, getAdaflowToken } from '../../src/services/adaflow/settings';

describe('ImportPreview UI Component', () => {
  const validPreview: BackupPreview = {
    schemaVersion: 1,
    exportedAt: '2026-11-19T14:30:00.000Z',
    counts: {
      payments: 12,
      takers: 3,
      templates: 2,
      nfseOperations: 5,
    },
    duplicates: {
      payments: 4,
      takers: 1,
      templates: 0,
      nfseOperations: 1,
    },
    validationErrors: [],
    isValid: true,
  };

  const invalidPreview: BackupPreview = {
    schemaVersion: 0,
    exportedAt: '',
    counts: { payments: 0, takers: 0, templates: 0, nfseOperations: 0 },
    duplicates: { payments: 0, takers: 0, templates: 0, nfseOperations: 0 },
    validationErrors: [
      'schemaVersion: Expected 1, received 2',
      'payments.0.provider: Invalid enum value',
    ],
    isValid: false,
  };

  it('renders preview counts, duplicates and metadata correctly', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ImportPreview
        preview={validPreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId('preview-schema-version')).toHaveTextContent('v1');
    expect(screen.getByTestId('count-payments')).toHaveTextContent('12');
    expect(screen.getByTestId('duplicates-payments')).toHaveTextContent('4');
    expect(screen.getByTestId('count-takers')).toHaveTextContent('3');
    expect(screen.getByTestId('duplicates-takers')).toHaveTextContent('1');
    expect(screen.getByTestId('count-templates')).toHaveTextContent('2');
    expect(screen.getByTestId('duplicates-templates')).toHaveTextContent('0');
    expect(screen.getByTestId('count-operations')).toHaveTextContent('5');
    expect(screen.getByTestId('duplicates-operations')).toHaveTextContent('1');
  });

  it('displays validation error banner and disables confirmation button for invalid files', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ImportPreview
        preview={invalidPreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId('import-validation-errors')).toBeInTheDocument();
    expect(
      screen.getByText('schemaVersion: Expected 1, received 2'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('payments.0.provider: Invalid enum value'),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByTestId('confirm-import-btn');
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancelar button is clicked leaving database untouched', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ImportPreview
        preview={validPreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const cancelBtn = screen.getByTestId('cancel-import-btn');
    fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('allows selecting merge or replace mode and passes choice to onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ImportPreview
        preview={validPreview}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const mergeRadio = screen.getByTestId('mode-merge-radio');
    const replaceRadio = screen.getByTestId('mode-replace-radio');
    const confirmBtn = screen.getByTestId('confirm-import-btn');

    // Default mode is merge
    expect(mergeRadio).toBeChecked();
    expect(replaceRadio).not.toBeChecked();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('merge');

    // Switch to replace mode
    fireEvent.click(replaceRadio);
    expect(replaceRadio).toBeChecked();
    expect(mergeRadio).not.toBeChecked();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('replace');
  });
});

describe('DataSettingsScreen UI', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    _resetMemoryTokenForTesting();
    testDb = createDatabase(`test-ui-db-${Date.now()}-${Math.random()}`);
    await testDb.open();
  });

  it('renders backup and danger zone sections', () => {
    render(<DataSettingsScreen />);

    expect(screen.getByTestId('backup-restore-section')).toBeInTheDocument();
    expect(screen.getByTestId('danger-zone-section')).toBeInTheDocument();
    expect(screen.getByTestId('export-backup-btn')).toBeInTheDocument();
    expect(screen.getByTestId('import-backup-btn')).toBeInTheDocument();
    expect(screen.getByTestId('delete-all-data-btn')).toBeInTheDocument();
  });

  it('triggers JSON export on Exportar Dados button click', async () => {
    const exportSpy = vi.spyOn(backupService, 'exportBackupJson').mockResolvedValue({
      jsonString: '{"test":true}',
      filename: 'pingounota-backup-2026-11-19.json',
      envelope: {
        schemaVersion: 1,
        exportedAt: '2026-11-19T00:00:00.000Z',
        payments: [],
        takers: [],
        templates: [],
        nfseOperations: [],
      },
    });
    const downloadSpy = vi.spyOn(backupService, 'downloadBackupFile').mockImplementation(() => {});

    render(<DataSettingsScreen />);

    const exportBtn = screen.getByTestId('export-backup-btn');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalled();
      expect(downloadSpy).toHaveBeenCalled();
      expect(screen.getByTestId('data-settings-feedback')).toHaveTextContent(
        'Backup exportado com sucesso: pingounota-backup-2026-11-19.json',
      );
    });

    exportSpy.mockRestore();
    downloadSpy.mockRestore();
  });

  it('handles delete-all confirmation requiring typing EXCLUIR', async () => {
    await saveAdaflowToken('tok_safe_token');
    const onDataChanged = vi.fn();

    render(<DataSettingsScreen onDataChanged={onDataChanged} />);

    const deleteAllBtn = screen.getByTestId('delete-all-data-btn');
    fireEvent.click(deleteAllBtn);

    // Dialog opens explaining scope
    expect(screen.getByTestId('delete-all-confirm-dialog')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Esta ação apagará permanentemente todos os pagamentos detectados.*O token da Adaflow não será afetado/i,
      ),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByTestId('confirm-delete-all-btn');
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByTestId('confirm-delete-phrase-input');

    // Typing wrong phrase leaves button disabled
    fireEvent.change(input, { target: { value: 'NAO' } });
    expect(confirmBtn).toBeDisabled();

    // Typing EXCLUIR enables button
    fireEvent.change(input, { target: { value: 'EXCLUIR' } });
    expect(confirmBtn).not.toBeDisabled();

    // Confirm deletion
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('data-settings-feedback')).toHaveTextContent(
        'Todos os dados locais foram excluídos com sucesso. O token da Adaflow não foi afetado.',
      );
    });

    // Token must remain intact
    expect(await getAdaflowToken()).toBe('tok_safe_token');
    expect(onDataChanged).toHaveBeenCalled();
  });

  it('allows canceling delete-all dialog without performing any action', () => {
    render(<DataSettingsScreen />);

    fireEvent.click(screen.getByTestId('delete-all-data-btn'));
    expect(screen.getByTestId('delete-all-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-delete-all-btn'));
    expect(screen.queryByTestId('delete-all-confirm-dialog')).not.toBeInTheDocument();
  });
});
