import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import TemplatesScreen from '../../entrypoints/sidepanel/screens/TemplatesScreen';
import TakersScreen from '../../entrypoints/sidepanel/screens/TakersScreen';
import TemplateEditor from '../../entrypoints/sidepanel/components/TemplateEditor';
import TakerForm from '../../entrypoints/sidepanel/components/TakerForm';

describe('TemplatesScreen & TemplateEditor UI', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-ui-templates-${Date.now()}-${Math.random()}`);
    await testDb.templates.clear();
  });

  it('shows empty state when no templates exist', async () => {
    render(<TemplatesScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('templates-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Nenhum modelo cadastrado')).toBeInTheDocument();
  });

  it('validates required fields in TemplateEditor and displays errors inline without losing entered text', async () => {
    const handleSave = vi.fn();
    const handleCancel = vi.fn();

    render(
      <TemplateEditor
        onSave={handleSave}
        onCancel={handleCancel}
      />,
    );

    // Enter some data into name but clear description
    const descInput = screen.getByLabelText(/Descrição do Serviço/i);
    fireEvent.change(descInput, { target: { value: '' } });

    const saveBtn = screen.getByRole('button', { name: /Salvar Modelo/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Nome da template é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('CNAE é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Descrição é obrigatória')).toBeInTheDocument();
    });

    expect(handleSave).not.toHaveBeenCalled();

    // Fill in valid data and submit
    const nameInput = screen.getByLabelText(/Nome do Modelo/i);
    const cnaeInput = screen.getByLabelText(/Código CNAE/i);

    fireEvent.change(nameInput, { target: { value: 'Desenvolvimento Web' } });
    fireEvent.change(cnaeInput, { target: { value: '6201-5/01' } });
    fireEvent.change(descInput, {
      target: { value: 'Serviço prestado em {{mes}}/{{ano}}.' },
    });

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledTimes(1);
    });

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Desenvolvimento Web',
        cnae: '6201-5/01',
        description: 'Serviço prestado em {{mes}}/{{ano}}.',
      }),
    );
  });

  it('creates and lists a template in TemplatesScreen', async () => {
    render(<TemplatesScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-new-template')).toBeInTheDocument();
    });

    // Click new template button
    fireEvent.click(screen.getByTestId('btn-new-template'));

    // Fill form
    fireEvent.change(screen.getByLabelText(/Nome do Modelo/i), {
      target: { value: 'Consultoria TI' },
    });
    fireEvent.change(screen.getByLabelText(/Código CNAE/i), {
      target: { value: '6202-0/00' },
    });
    fireEvent.change(screen.getByLabelText(/Descrição do Serviço/i), {
      target: { value: 'Consultoria mês {{mes}}' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Salvar Modelo/i }));

    // Verify it appears in the list
    await waitFor(() => {
      expect(screen.getByText('Consultoria TI')).toBeInTheDocument();
      expect(screen.getByText('CNAE 6202-0/00')).toBeInTheDocument();
    });
  });
});

describe('TakersScreen & TakerForm UI', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-ui-takers-${Date.now()}-${Math.random()}`);
    await testDb.takers.clear();
  });

  it('shows empty state when no takers exist', async () => {
    render(<TakersScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('takers-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Nenhum tomador cadastrado')).toBeInTheDocument();
  });

  it('validates taker fields and displays inline validation errors without losing data', async () => {
    const handleSave = vi.fn();
    const handleCancel = vi.fn();

    render(
      <TakerForm
        onSave={handleSave}
        onCancel={handleCancel}
      />,
    );

    // Submit empty form
    const saveBtn = screen.getByRole('button', { name: /Salvar Tomador/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Nome do tomador é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Logradouro é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Cidade é obrigatória')).toBeInTheDocument();
      expect(screen.getByText('Estado deve ter 2 caracteres')).toBeInTheDocument();
      expect(screen.getByText('CEP é obrigatório')).toBeInTheDocument();
    });

    expect(handleSave).not.toHaveBeenCalled();

    // Type invalid document (invalid CPF digits)
    const docInput = screen.getByLabelText(/Documento \(CPF \/ CNPJ\)/i);
    fireEvent.change(docInput, { target: { value: '111.111.111-11' } });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Documento deve ser um CPF ou CNPJ válido'),
      ).toBeInTheDocument();
    });

    // Retains entered invalid document
    expect(docInput).toHaveValue('111.111.111-11');
  });

  it('formats CEP and creates taker successfully', async () => {
    render(<TakersScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-new-taker')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-new-taker'));

    fireEvent.change(screen.getByLabelText(/Nome \/ Razão Social/i), {
      target: { value: 'Empresa Parceira' },
    });
    fireEvent.change(screen.getByLabelText(/Logradouro/i), {
      target: { value: 'Rua das Flores' },
    });
    fireEvent.change(screen.getByLabelText(/Cidade/i), {
      target: { value: 'Curitiba' },
    });
    fireEvent.change(screen.getByLabelText(/UF/i), {
      target: { value: 'pr' },
    });
    fireEvent.change(screen.getByLabelText(/CEP/i), {
      target: { value: '80000000' },
    });

    // State should be uppercase PR
    expect(screen.getByLabelText(/UF/i)).toHaveValue('PR');
    // CEP should be formatted
    expect(screen.getByLabelText(/CEP/i)).toHaveValue('80000-000');

    fireEvent.click(screen.getByRole('button', { name: /Salvar Tomador/i }));

    await waitFor(() => {
      expect(screen.getByText('Empresa Parceira')).toBeInTheDocument();
      expect(screen.getByText(/Curitiba\/PR/)).toBeInTheDocument();
    });
  });
});
