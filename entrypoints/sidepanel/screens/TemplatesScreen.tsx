import React, { useCallback, useEffect, useState } from 'react';
import type { ServiceTemplate } from '../../../src/domain/template';
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from '../../../src/services/templates';
import { db, type PingouNotaDB } from '../../../src/storage/database';
import TemplateEditor from '../components/TemplateEditor';

export interface TemplatesScreenProps {
  dbInstance?: PingouNotaDB;
  onSelectTemplate?: (template: ServiceTemplate) => void;
}

export const TemplatesScreen: React.FC<TemplatesScreenProps> = ({
  dbInstance = db,
  onSelectTemplate,
}) => {
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<
    ServiceTemplate | null | 'new'
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      setIsLoading(true);
      const items = await listTemplates(dbInstance);
      setTemplates(items);
    } catch (err) {
      console.error('[PingouNota] Falha ao listar modelos:', err);
      setFeedbackMessage('Falha ao carregar modelos cadastrados.');
    } finally {
      setIsLoading(false);
    }
  }, [dbInstance]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleCreateNew = () => {
    setEditingTemplate('new');
    setFeedbackMessage(null);
  };

  const handleEdit = (tmpl: ServiceTemplate) => {
    setEditingTemplate(tmpl);
    setFeedbackMessage(null);
  };

  const handleSave = async (saved: ServiceTemplate) => {
    await saveTemplate(saved, dbInstance);
    setEditingTemplate(null);
    setFeedbackMessage('Modelo de serviço salvo com sucesso!');
    await loadTemplates();
  };

  const handleDelete = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      return;
    }
    try {
      await deleteTemplate(id, dbInstance);
      setDeletingId(null);
      setFeedbackMessage('Modelo excluído com sucesso.');
      await loadTemplates();
    } catch (err) {
      console.error('[PingouNota] Falha ao excluir modelo:', err);
      setFeedbackMessage('Erro ao excluir modelo.');
    }
  };

  return (
    <div className="subscreen-container" data-testid="templates-screen">
      <header className="subscreen-header">
        <div>
          <h2>Modelos de Serviço</h2>
          <p className="subscreen-subtitle">
            Configure templates de descrição e dados fiscais pré-preenchidos.
          </p>
        </div>
        {!editingTemplate && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreateNew}
            data-testid="btn-new-template"
          >
            + Novo Modelo
          </button>
        )}
      </header>

      {feedbackMessage && (
        <div className="feedback-banner" role="status">
          <span>{feedbackMessage}</span>
          <button
            type="button"
            className="btn-icon-dismiss"
            onClick={() => setFeedbackMessage(null)}
            aria-label="Dispensar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {editingTemplate ? (
        <TemplateEditor
          initialTemplate={editingTemplate === 'new' ? null : editingTemplate}
          onSave={handleSave}
          onCancel={() => setEditingTemplate(null)}
        />
      ) : (
        <div className="templates-list-section">
          {isLoading ? (
            <div className="loading-state">
              <span className="spinner" aria-hidden="true" />
              <span>Carregando modelos...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="empty-state" data-testid="templates-empty-state">
              <div className="empty-icon" aria-hidden="true">
                📋
              </div>
              <h3>Nenhum modelo cadastrado</h3>
              <p>
                Cadastre modelos de serviço para automatizar o preenchimento de
                descrição, CNAE e retenção de impostos.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCreateNew}
              >
                Cadastrar primeiro modelo
              </button>
            </div>
          ) : (
            <div className="items-grid" role="list">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="item-card"
                  role="listitem"
                  data-testid={`template-card-${tmpl.id}`}
                >
                  <div className="item-header">
                    <h3 className="item-title">{tmpl.name}</h3>
                    <span className="badge badge-cnae">CNAE {tmpl.cnae}</span>
                  </div>

                  <p className="item-description-text">{tmpl.description}</p>

                  <div className="item-badges-row">
                    {tmpl.withholdTaxes && (
                      <span className="badge badge-warning">
                        Reter impostos
                      </span>
                    )}
                    {tmpl.forwardingEmail && (
                      <span className="badge badge-email">
                        ✉ {tmpl.forwardingEmail}
                      </span>
                    )}
                  </div>

                  <div className="item-card-actions">
                    {onSelectTemplate && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onSelectTemplate(tmpl)}
                      >
                        Selecionar
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEdit(tmpl)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${
                        deletingId === tmpl.id
                          ? 'btn-danger'
                          : 'btn-secondary btn-delete'
                      }`}
                      onClick={() => handleDelete(tmpl.id)}
                    >
                      {deletingId === tmpl.id ? 'Confirmar exclusão?' : 'Excluir'}
                    </button>
                    {deletingId === tmpl.id && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDeletingId(null)}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TemplatesScreen;
