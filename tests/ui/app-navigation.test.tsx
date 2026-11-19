import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../entrypoints/sidepanel/App';
import { db } from '../../src/storage/database';

describe('App Navigation and Tab Integration', () => {
  beforeEach(async () => {
    await db.payments.clear();
    await db.templates.clear();
    await db.takers.clear();
  });

  it('renders tab navigation with Pagamentos, Operações, Modelos, Tomadores, Configurações', async () => {
    render(<App />);

    expect(screen.getByRole('tab', { name: 'Pagamentos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Operações' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Modelos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tomadores' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Configurações' }),
    ).toBeInTheDocument();
  });

  it('switches between tabs and displays the respective screens', async () => {
    render(<App />);

    // Initially on Pagamentos tab
    expect(screen.getByRole('tab', { name: 'Pagamentos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('payments-screen')).toBeInTheDocument();

    // Switch to Operações
    fireEvent.click(screen.getByRole('tab', { name: 'Operações' }));
    await waitFor(() => {
      expect(screen.getByTestId('operations-screen')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Operações' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Switch to Modelos
    fireEvent.click(screen.getByRole('tab', { name: 'Modelos' }));
    await waitFor(() => {
      expect(screen.getByTestId('templates-screen')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Modelos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Switch to Tomadores
    fireEvent.click(screen.getByRole('tab', { name: 'Tomadores' }));
    await waitFor(() => {
      expect(screen.getByTestId('takers-screen')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Tomadores' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Switch to Configurações
    fireEvent.click(screen.getByRole('tab', { name: 'Configurações' }));
    await waitFor(() => {
      expect(screen.getByText('Integração Adaflow')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Configurações' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
