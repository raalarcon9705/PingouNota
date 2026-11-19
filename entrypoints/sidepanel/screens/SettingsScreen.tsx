import React, { useEffect, useState } from 'react';
import {
  getAdaflowToken,
  saveAdaflowToken,
  removeAdaflowToken,
} from '../../../src/services/adaflow/settings';

export const SettingsScreen: React.FC = () => {
  const [tokenInput, setTokenInput] = useState('');
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getAdaflowToken()
      .then((token) => {
        if (isMounted && token) {
          setSavedToken(token);
          setTokenInput(token);
        }
      })
      .catch((err) => {
        console.error('[PingouNota] Erro ao carregar token de configurações:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const trimmed = tokenInput.trim();

    if (!trimmed) {
      setFeedback({
        type: 'error',
        message: 'Por favor, insira um token de API válido antes de salvar.',
      });
      return;
    }

    try {
      setIsSaving(true);
      await saveAdaflowToken(trimmed);
      setSavedToken(trimmed);
      setFeedback({
        type: 'success',
        message: 'Token de API da Adaflow salvo com sucesso!',
      });
    } catch {
      setFeedback({
        type: 'error',
        message: 'Erro ao salvar o token. Tente novamente.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartDelete = () => {
    setFeedback(null);
    setIsConfirmingDelete(true);
  };

  const handleCancelDelete = () => {
    setIsConfirmingDelete(false);
  };

  const handleConfirmDelete = async () => {
    try {
      await removeAdaflowToken();
      setSavedToken(null);
      setTokenInput('');
      setIsConfirmingDelete(false);
      setFeedback({
        type: 'success',
        message: 'Token de API da Adaflow removido com sucesso.',
      });
    } catch {
      setFeedback({
        type: 'error',
        message: 'Erro ao remover o token. Tente novamente.',
      });
    }
  };

  return (
    <div className="subscreen-container" data-testid="settings-screen">
      <header className="subscreen-header">
        <div>
          <h2>Configurações</h2>
          <p className="subscreen-subtitle">
            Preferências gerais e integração com a Adaflow.
          </p>
        </div>
      </header>

      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-card-header">
            <h3>Integração Adaflow</h3>
            {savedToken ? (
              <span className="badge badge-success" data-testid="token-status-badge">
                Configurado
              </span>
            ) : (
              <span className="badge badge-muted" data-testid="token-status-badge">
                Não configurado
              </span>
            )}
          </div>

          <p className="settings-description">
            Para emitir notas fiscais, insira seu token de API da Adaflow. Você pode
            gerar ou visualizar seu token no painel da Adaflow em Configurações &gt;
            Integrações.
          </p>

          <form onSubmit={handleSave} className="settings-form">
            <div className="form-group">
              <label htmlFor="adaflow-token-input">Token de API da Adaflow</label>
              <div className="token-input-wrapper">
                <input
                  id="adaflow-token-input"
                  data-testid="adaflow-token-input"
                  type={showToken ? 'text' : 'password'}
                  className="form-input token-input"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Insira seu token da Adaflow..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="token-toggle-btn"
                  data-testid="toggle-token-visibility"
                  onClick={() => setShowToken(!showToken)}
                  aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                >
                  {showToken ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            {feedback && (
              <div
                className={`settings-feedback settings-feedback-${feedback.type}`}
                role="status"
                data-testid="settings-feedback"
              >
                {feedback.message}
              </div>
            )}

            {isConfirmingDelete ? (
              <div className="token-confirm-box" data-testid="token-confirm-box">
                <p>
                  <strong>Remover token?</strong> Você não poderá emitir notas fiscais
                  pela Adaflow enquanto o token estiver ausente.
                </p>
                <div className="token-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid="confirm-remove-btn"
                    onClick={handleConfirmDelete}
                  >
                    Confirmar Remoção
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="cancel-remove-btn"
                    onClick={handleCancelDelete}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="settings-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-testid="save-token-btn"
                  disabled={isSaving}
                >
                  {isSaving ? 'Salvando...' : 'Salvar Token'}
                </button>
                {savedToken && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="remove-token-btn"
                    onClick={handleStartDelete}
                  >
                    Remover Token
                  </button>
                )}
              </div>
            )}
          </form>
        </div>

        <div className="settings-card">
          <h3>Armazenamento Local</h3>
          <p>
            Todos os dados de pagamentos, modelos e tomadores são salvos no banco de
            dados Dexie IndexedDB do seu navegador. O token de API é guardado
            exclusivamente no armazenamento local seguro da extensão.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SettingsScreen;
