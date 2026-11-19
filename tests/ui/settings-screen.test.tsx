import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsScreen from '../../entrypoints/sidepanel/screens/SettingsScreen';
import {
  getAdaflowToken,
  saveAdaflowToken,
  _resetMemoryTokenForTesting,
} from '../../src/services/adaflow/settings';

describe('SettingsScreen UI', () => {
  beforeEach(() => {
    _resetMemoryTokenForTesting();
  });

  it('renders guidance copy explaining how to get token in Adaflow', async () => {
    render(<SettingsScreen />);

    expect(
      screen.getByText(/Para emitir notas fiscais, insira seu token de API da Adaflow/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Configurações > Integrações/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Integração Adaflow')).toBeInTheDocument();
  });

  it('displays "Não configurado" badge when no token is present', async () => {
    render(<SettingsScreen />);

    const badge = screen.getByTestId('token-status-badge');
    expect(badge).toHaveTextContent('Não configurado');
    expect(screen.queryByTestId('remove-token-btn')).not.toBeInTheDocument();
  });

  it('toggles password visibility between password and text', async () => {
    render(<SettingsScreen />);

    const tokenInput = screen.getByTestId('adaflow-token-input');
    const toggleBtn = screen.getByTestId('toggle-token-visibility');

    expect(tokenInput).toHaveAttribute('type', 'password');
    expect(toggleBtn).toHaveTextContent('Mostrar');

    fireEvent.click(toggleBtn);

    expect(tokenInput).toHaveAttribute('type', 'text');
    expect(toggleBtn).toHaveTextContent('Ocultar');

    fireEvent.click(toggleBtn);

    expect(tokenInput).toHaveAttribute('type', 'password');
  });

  it('shows error feedback when saving empty token', async () => {
    render(<SettingsScreen />);

    const saveBtn = screen.getByTestId('save-token-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const feedback = screen.getByTestId('settings-feedback');
      expect(feedback).toHaveTextContent(
        'Por favor, insira um token de API válido antes de salvar.',
      );
    });
  });

  it('saves token and updates UI status and badge', async () => {
    render(<SettingsScreen />);

    const tokenInput = screen.getByTestId('adaflow-token-input');
    const saveBtn = screen.getByTestId('save-token-btn');

    fireEvent.change(tokenInput, { target: { value: 'tok_live_123456789' } });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('settings-feedback')).toHaveTextContent(
        'Token de API da Adaflow salvo com sucesso!',
      );
    });

    expect(screen.getByTestId('token-status-badge')).toHaveTextContent('Configurado');
    expect(screen.getByTestId('remove-token-btn')).toBeInTheDocument();
    expect(await getAdaflowToken()).toBe('tok_live_123456789');
  });

  it('handles token removal confirmation flow', async () => {
    await saveAdaflowToken('existing_token_xyz');
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('token-status-badge')).toHaveTextContent('Configurado');
    });

    const removeBtn = screen.getByTestId('remove-token-btn');
    fireEvent.click(removeBtn);

    // Confirmation box is shown
    expect(screen.getByTestId('token-confirm-box')).toBeInTheDocument();
    expect(
      screen.getByText(/Você não poderá emitir notas fiscais pela Adaflow/i),
    ).toBeInTheDocument();

    // Test cancel
    const cancelBtn = screen.getByTestId('cancel-remove-btn');
    fireEvent.click(cancelBtn);
    expect(screen.queryByTestId('token-confirm-box')).not.toBeInTheDocument();
    expect(await getAdaflowToken()).toBe('existing_token_xyz');

    // Open confirm box again and confirm
    fireEvent.click(screen.getByTestId('remove-token-btn'));
    const confirmBtn = screen.getByTestId('confirm-remove-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('settings-feedback')).toHaveTextContent(
        'Token de API da Adaflow removido com sucesso.',
      );
    });

    expect(screen.getByTestId('token-status-badge')).toHaveTextContent('Não configurado');
    expect(await getAdaflowToken()).toBeNull();
  });
});
