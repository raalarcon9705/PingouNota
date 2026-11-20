import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import TemplatesScreen from '../../entrypoints/sidepanel/screens/TemplatesScreen';
import TakersScreen from '../../entrypoints/sidepanel/screens/TakersScreen';
import TemplateEditor from '../../entrypoints/sidepanel/components/TemplateEditor';
import TakerForm from '../../entrypoints/sidepanel/components/TakerForm';
import {
  saveProposedTakers,
  saveProposedTemplates,
  getProposedTakers,
  getProposedTemplates,
  _resetProposedForTesting,
} from '../../src/services/adaflow-reconciliation';

describe('TemplatesScreen & TemplateEditor UI', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    _resetProposedForTesting();
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

  it('renders proposed templates section, allows reviewing and approving a proposal', async () => {
    await saveProposedTemplates([
      {
        id: 'prop_tmpl_001',
        name: 'Modelo - Desenvolvimento Fullstack',
        description: 'Serviço de desenvolvimento fullstack em React e Node.',
        cnae: '6201-5/01',
        withholdTaxes: false,
        discoveredFromNfse: 'Nº 99',
        suggestedAt: new Date().toISOString(),
      },
    ]);

    render(<TemplatesScreen dbInstance={testDb} />);

    // Wait for proposal card to render
    await waitFor(() => {
      expect(screen.getByTestId('proposed-templates-section')).toBeInTheDocument();
      expect(screen.getByText('Modelos sugeridos da Adaflow')).toBeInTheDocument();
      expect(screen.getByText('Modelo - Desenvolvimento Fullstack')).toBeInTheDocument();
      expect(screen.getByText(/Nº 99/)).toBeInTheDocument();
    });

    // Click "Revisar e Salvar"
    fireEvent.click(screen.getByTestId('btn-review-proposal-prop_tmpl_001'));

    // Verify TemplateEditor is opened with pre-filled candidate data
    await waitFor(() => {
      expect(screen.getByLabelText(/Nome do Modelo/i)).toHaveValue('Modelo - Desenvolvimento Fullstack');
      expect(screen.getByLabelText(/Código CNAE/i)).toHaveValue('6201-5/01');
      expect(screen.getByLabelText(/Descrição do Serviço/i)).toHaveValue(
        'Serviço de desenvolvimento fullstack em React e Node.',
      );
    });

    // Save template
    fireEvent.click(screen.getByRole('button', { name: /Salvar Modelo/i }));

    // Verify template is now persisted in Dexie and proposals list is cleared
    await waitFor(() => {
      expect(screen.getByText('Modelo de serviço salvo com sucesso!')).toBeInTheDocument();
      expect(screen.queryByTestId('proposed-templates-section')).not.toBeInTheDocument();
    });

    const inDb = await testDb.templates.toArray();
    expect(inDb).toHaveLength(1);
    expect(inDb[0]?.name).toBe('Modelo - Desenvolvimento Fullstack');
    const remainingProposals = await getProposedTemplates();
    expect(remainingProposals).toHaveLength(0);
  });

  it('allows discarding a proposed template without adding to database', async () => {
    await saveProposedTemplates([
      {
        id: 'prop_tmpl_002',
        name: 'Modelo Descartável',
        description: 'Descrição de teste para descarte.',
        cnae: '6201-5/01',
        discoveredFromNfse: 'Nº 100',
        suggestedAt: new Date().toISOString(),
      },
    ]);

    render(<TemplatesScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('proposed-templates-section')).toBeInTheDocument();
      expect(screen.getByText('Modelo Descartável')).toBeInTheDocument();
    });

    // Click "Descartar"
    fireEvent.click(screen.getByTestId('btn-dismiss-proposal-prop_tmpl_002'));

    await waitFor(() => {
      expect(screen.queryByTestId('proposed-templates-section')).not.toBeInTheDocument();
    });

    const inDb = await testDb.templates.toArray();
    expect(inDb).toHaveLength(0);
    const remainingProposals = await getProposedTemplates();
    expect(remainingProposals).toHaveLength(0);
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

    // Submit empty form (default country is Brasil)
    const saveBtn = screen.getByRole('button', { name: /Salvar Tomador/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Nome do tomador é obrigatório')).toBeInTheDocument();
      expect(
        screen.getByText('CPF ou CNPJ é obrigatório para tomadores no Brasil.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Logradouro é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Cidade é obrigatória')).toBeInTheDocument();
      expect(screen.getByText('Estado deve ter 2 caracteres')).toBeInTheDocument();
      expect(screen.getByText('CEP é obrigatório')).toBeInTheDocument();
    });

    expect(handleSave).not.toHaveBeenCalled();

    // Type invalid document (invalid CPF digits)
    const docInput = screen.getByLabelText(/CPF ou CNPJ/i);
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

  it('requires CPF/CNPJ for Brazilian takers and prevents saving when empty', async () => {
    const handleSave = vi.fn();
    const handleCancel = vi.fn();

    render(
      <TakerForm
        onSave={handleSave}
        onCancel={handleCancel}
      />,
    );

    // Fill valid data for all fields except document (country is Brasil by default)
    fireEvent.change(screen.getByLabelText(/Nome \/ Razão Social/i), {
      target: { value: 'Tomador Brasil' },
    });
    fireEvent.change(screen.getByLabelText(/Logradouro/i), {
      target: { value: 'Rua Teste' },
    });
    fireEvent.change(screen.getByLabelText(/Cidade/i), {
      target: { value: 'São Paulo' },
    });
    fireEvent.change(screen.getByLabelText(/UF/i), {
      target: { value: 'SP' },
    });
    fireEvent.change(screen.getByLabelText(/CEP/i), {
      target: { value: '01310-100' },
    });

    // Document is intentionally left empty
    const saveBtn = screen.getByRole('button', { name: /Salvar Tomador/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText('CPF ou CNPJ é obrigatório para tomadores no Brasil.'),
      ).toBeInTheDocument();
    });

    expect(handleSave).not.toHaveBeenCalled();

    // Now provide valid CPF/CNPJ
    fireEvent.change(screen.getByLabelText(/CPF ou CNPJ/i), {
      target: { value: '00000000000191' },
    });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledTimes(1);
    });

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Tomador Brasil',
        document: '00.000.000/0001-91',
      }),
    );
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
    fireEvent.change(screen.getByLabelText(/CPF ou CNPJ/i), {
      target: { value: '00000000000191' },
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
    // CNPJ should be formatted
    expect(screen.getByLabelText(/CPF ou CNPJ/i)).toHaveValue('00.000.000/0001-91');

    fireEvent.click(screen.getByRole('button', { name: /Salvar Tomador/i }));

    await waitFor(() => {
      expect(screen.getByText('Empresa Parceira')).toBeInTheDocument();
      expect(screen.getByText('00.000.000/0001-91')).toBeInTheDocument();
      expect(screen.getByText(/Curitiba\/PR/)).toBeInTheDocument();
    });
  });

  it('renders phone input field and persists phone in TakerForm', async () => {
    const handleSave = vi.fn();
    const handleCancel = vi.fn();

    render(
      <TakerForm
        onSave={handleSave}
        onCancel={handleCancel}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Nome \/ Razão Social/i), {
      target: { value: 'Tomador Com Telefone' },
    });
    fireEvent.change(screen.getByLabelText(/CPF ou CNPJ/i), {
      target: { value: '00000000000191' },
    });
    fireEvent.change(screen.getByLabelText(/Telefone/i), {
      target: { value: '(11) 98765-4321' },
    });
    fireEvent.change(screen.getByLabelText(/Logradouro/i), {
      target: { value: 'Av. Paulista' },
    });
    fireEvent.change(screen.getByLabelText(/Cidade/i), {
      target: { value: 'São Paulo' },
    });
    fireEvent.change(screen.getByLabelText(/UF/i), {
      target: { value: 'SP' },
    });
    fireEvent.change(screen.getByLabelText(/CEP/i), {
      target: { value: '01310-100' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Salvar Tomador/i }));

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledTimes(1);
    });

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Tomador Com Telefone',
        phone: '(11) 98765-4321',
      }),
    );
  });

  it('renders proposed takers section, allows reviewing and approving a proposal with pre-filled phone and doc', async () => {
    await saveProposedTakers([
      {
        id: 'prop_taker_001',
        serviceTakerId: 'ext_9876',
        name: 'Cliente Sugerido Adaflow Ltda',
        document: '00.000.000/0001-91',
        email: 'financeiro@sugerido.com',
        phone: '(11) 99999-8888',
        address: {
          line1: 'Rua do Comércio',
          number: '200',
          neighborhood: 'Centro',
          city: 'Campinas',
          state: 'SP',
          postalCode: '13010-000',
          country: 'BR',
        },
        discoveredFromNfse: 'NFSe Nº 123',
        suggestedAt: new Date().toISOString(),
      },
    ]);

    render(<TakersScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('proposed-takers-section')).toBeInTheDocument();
      expect(screen.getByText('Sugestões da Adaflow')).toBeInTheDocument();
      expect(screen.getByText('Cliente Sugerido Adaflow Ltda')).toBeInTheDocument();
      expect(screen.getByText('ID: ext_9876')).toBeInTheDocument();
      expect(screen.getByText(/00\.000\.000\/0001-91/)).toBeInTheDocument();
      expect(screen.getByText('(11) 99999-8888')).toBeInTheDocument();
      expect(screen.getByText('NFSe Nº 123')).toBeInTheDocument();
    });

    // Click "Revisar e Aprovar"
    fireEvent.click(screen.getByTestId('btn-review-proposal-prop_taker_001'));

    // Check pre-filled values in TakerForm
    await waitFor(() => {
      expect(screen.getByLabelText(/Nome \/ Razão Social/i)).toHaveValue('Cliente Sugerido Adaflow Ltda');
      expect(screen.getByLabelText(/CPF ou CNPJ/i)).toHaveValue('00.000.000/0001-91');
      expect(screen.getByLabelText(/ID Externo/i)).toHaveValue('ext_9876');
      expect(screen.getByLabelText(/E-mail/i)).toHaveValue('financeiro@sugerido.com');
      expect(screen.getByLabelText(/Telefone/i)).toHaveValue('(11) 99999-8888');
      expect(screen.getByLabelText(/Logradouro/i)).toHaveValue('Rua do Comércio');
    });

    // Save
    fireEvent.click(screen.getByRole('button', { name: /Salvar Tomador/i }));

    // Verify it is saved in Dexie and proposals cleared
    await waitFor(() => {
      expect(screen.getByText('Tomador de serviço salvo com sucesso!')).toBeInTheDocument();
      expect(screen.queryByTestId('proposed-takers-section')).not.toBeInTheDocument();
    });

    const inDb = await testDb.takers.toArray();
    expect(inDb).toHaveLength(1);
    expect(inDb[0]?.name).toBe('Cliente Sugerido Adaflow Ltda');
    expect(inDb[0]?.phone).toBe('(11) 99999-8888');
    const remaining = await getProposedTakers();
    expect(remaining).toHaveLength(0);
  });

  it('allows discarding a proposed taker without adding to database', async () => {
    await saveProposedTakers([
      {
        id: 'prop_taker_002',
        name: 'Tomador Descartável',
        document: null,
        suggestedAt: new Date().toISOString(),
      },
    ]);

    render(<TakersScreen dbInstance={testDb} />);

    await waitFor(() => {
      expect(screen.getByTestId('proposed-takers-section')).toBeInTheDocument();
      expect(screen.getByText('Tomador Descartável')).toBeInTheDocument();
    });

    // Click "Descartar"
    fireEvent.click(screen.getByTestId('btn-dismiss-proposal-prop_taker_002'));

    await waitFor(() => {
      expect(screen.queryByTestId('proposed-takers-section')).not.toBeInTheDocument();
    });

    const inDb = await testDb.takers.toArray();
    expect(inDb).toHaveLength(0);
    const remaining = await getProposedTakers();
    expect(remaining).toHaveLength(0);
  });
});
