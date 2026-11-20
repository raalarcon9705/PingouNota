import React, { useCallback, useEffect, useState } from 'react';
import type { TakerProfile } from '../../../src/domain/taker';
import {
  deleteTaker,
  listTakers,
  saveTaker,
} from '../../../src/services/takers';
import { db, type PingouNotaDB } from '../../../src/storage/database';
import {
  getProposedTakers,
  approveProposedTaker,
  dismissProposedTaker,
  type ProposedTaker,
} from '../../../src/services/adaflow-reconciliation';
import TakerForm from '../components/TakerForm';

export interface TakersScreenProps {
  dbInstance?: PingouNotaDB;
  onSelectTaker?: (taker: TakerProfile) => void;
}

export const TakersScreen: React.FC<TakersScreenProps> = ({
  dbInstance = db,
  onSelectTaker,
}) => {
  const [takers, setTakers] = useState<TakerProfile[]>([]);
  const [proposals, setProposals] = useState<ProposedTaker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTaker, setEditingTaker] = useState<TakerProfile | null | 'new'>(
    null,
  );
  const [reviewingProposalId, setReviewingProposalId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const loadTakers = useCallback(async () => {
    try {
      setIsLoading(true);
      const [items, proposedItems] = await Promise.all([
        listTakers(dbInstance),
        getProposedTakers(),
      ]);
      setTakers(items);
      setProposals(proposedItems);
    } catch (err) {
      console.error('[PingouNota] Falha ao listar tomadores:', err);
      setFeedbackMessage('Falha ao carregar tomadores cadastrados.');
    } finally {
      setIsLoading(false);
    }
  }, [dbInstance]);

  useEffect(() => {
    loadTakers();
  }, [loadTakers]);

  const handleCreateNew = () => {
    setReviewingProposalId(null);
    setEditingTaker('new');
    setFeedbackMessage(null);
  };

  const handleEdit = (taker: TakerProfile) => {
    setReviewingProposalId(null);
    setEditingTaker(taker);
    setFeedbackMessage(null);
  };

  const handleReviewProposal = (proposal: ProposedTaker) => {
    setReviewingProposalId(proposal.id);
    setEditingTaker({
      id: proposal.serviceTakerId || proposal.id,
      name: proposal.name,
      document: proposal.document || null,
      externalId: proposal.serviceTakerId || null,
      email: proposal.email || null,
      phone: proposal.phone || null,
      address: proposal.address || {
        line1: 'Importado Adaflow',
        number: null,
        neighborhood: null,
        city: 'São Paulo',
        state: 'SP',
        postalCode: '01000-000',
        country: 'Brasil',
      },
    });
    setFeedbackMessage(null);
  };

  const handleDismissProposal = async (id: string) => {
    await dismissProposedTaker(id);
    setFeedbackMessage('Sugestão de tomador descartada.');
    await loadTakers();
  };

  const handleSave = async (saved: TakerProfile) => {
    if (reviewingProposalId) {
      await approveProposedTaker(reviewingProposalId, saved, dbInstance);
      setReviewingProposalId(null);
    } else {
      await saveTaker(saved, dbInstance);
    }
    setEditingTaker(null);
    setFeedbackMessage('Tomador de serviço salvo com sucesso!');
    await loadTakers();
  };

  const handleDelete = async (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      return;
    }
    try {
      await deleteTaker(id, dbInstance);
      setDeletingId(null);
      setFeedbackMessage('Tomador excluído com sucesso.');
      await loadTakers();
    } catch (err) {
      console.error('[PingouNota] Falha ao excluir tomador:', err);
      setFeedbackMessage('Erro ao excluir tomador.');
    }
  };

  return (
    <div className="subscreen-container" data-testid="takers-screen">
      <header className="subscreen-header">
        <div>
          <h2>Tomadores de Serviço</h2>
          <p className="subscreen-subtitle">
            Cadastre tomadores (clientes) para agilizar a emissão de NFSe.
          </p>
        </div>
        {!editingTaker && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreateNew}
            data-testid="btn-new-taker"
          >
            + Novo Tomador
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

      {editingTaker ? (
        <TakerForm
          initialTaker={editingTaker === 'new' ? null : editingTaker}
          onSave={handleSave}
          onCancel={() => {
            setEditingTaker(null);
            setReviewingProposalId(null);
          }}
        />
      ) : (
        <div className="takers-list-section">
          {/* Sugestões da Adaflow */}
          {proposals.length > 0 && (
            <section className="proposal-section" data-testid="proposed-takers-section">
              <div className="proposal-header">
                <h3>
                  Sugestões da Adaflow
                  <span className="proposal-pill-badge" data-testid="proposals-count">
                    {proposals.length}
                  </span>
                </h3>
              </div>
              <div className="proposal-list">
                {proposals.map((prop) => (
                  <div
                    key={prop.id}
                    className="proposal-card"
                    data-testid={`proposal-taker-${prop.id}`}
                  >
                    <div className="proposal-card-header">
                      <span className="proposal-card-title">{prop.name}</span>
                      {prop.serviceTakerId && (
                        <span className="proposal-badge">ID: {prop.serviceTakerId}</span>
                      )}
                    </div>
                    <div className="proposal-meta">
                      <div className="proposal-meta-row">
                        <strong>Documento:</strong>{' '}
                        {prop.document || 'Exterior / Sem documento'}
                      </div>
                      {prop.email && (
                        <div className="proposal-meta-row">
                          <strong>E-mail:</strong> {prop.email}
                        </div>
                      )}
                      {prop.phone && (
                        <div className="proposal-meta-row">
                          <strong>Telefone:</strong> {prop.phone}
                        </div>
                      )}
                      {prop.address && (
                        <div className="proposal-meta-row">
                          <strong>Endereço:</strong> {prop.address.line1}
                          {prop.address.number ? `, ${prop.address.number}` : ''}
                          {prop.address.city
                            ? ` - ${prop.address.city}/${prop.address.state}`
                            : ''}
                        </div>
                      )}
                      {prop.discoveredFromNfse && (
                        <div className="proposal-meta-row">
                          <strong>Origem:</strong> {prop.discoveredFromNfse}
                        </div>
                      )}
                    </div>
                    <div className="proposal-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleReviewProposal(prop)}
                        data-testid={`btn-review-proposal-${prop.id}`}
                      >
                        Revisar e Aprovar
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleDismissProposal(prop.id)}
                        data-testid={`btn-dismiss-proposal-${prop.id}`}
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {isLoading ? (
            <div className="loading-state">
              <span className="spinner" aria-hidden="true" />
              <span>Carregando tomadores...</span>
            </div>
          ) : takers.length === 0 ? (
            <div className="empty-state" data-testid="takers-empty-state">
              <div className="empty-icon" aria-hidden="true">
                🏢
              </div>
              <h3>Nenhum tomador cadastrado</h3>
              <p>
                Cadastre tomadores de serviço com CPF/CNPJ e endereço completo
                para automatizar suas emissões na Adaflow.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCreateNew}
              >
                Cadastrar primeiro tomador
              </button>
            </div>
          ) : (
            <div className="items-grid" role="list">
              {takers.map((taker) => (
                <div
                  key={taker.id}
                  className="item-card"
                  role="listitem"
                  data-testid={`taker-card-${taker.id}`}
                >
                  <div className="item-header">
                    <h3 className="item-title">{taker.name}</h3>
                    {taker.document && (
                      <span className="badge badge-document">
                        {taker.document}
                      </span>
                    )}
                  </div>

                  <div className="item-meta-info">
                    {taker.email && (
                      <span className="item-meta-row">
                        ✉ <strong>E-mail:</strong> {taker.email}
                      </span>
                    )}
                    {taker.phone && (
                      <span className="item-meta-row">
                        📞 <strong>Telefone:</strong> {taker.phone}
                      </span>
                    )}
                    <span className="item-meta-row">
                      📍 <strong>Endereço:</strong> {taker.address.line1}
                      {taker.address.number ? `, ${taker.address.number}` : ''}
                      {taker.address.neighborhood
                        ? ` - ${taker.address.neighborhood}`
                        : ''}
                      {` - ${taker.address.city}/${taker.address.state}`}
                    </span>
                    <span className="item-meta-row">
                      📮 <strong>CEP:</strong> {taker.address.postalCode}
                    </span>
                  </div>

                  <div className="item-card-actions">
                    {onSelectTaker && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onSelectTaker(taker)}
                      >
                        Selecionar
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEdit(taker)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${
                        deletingId === taker.id
                          ? 'btn-danger'
                          : 'btn-secondary btn-delete'
                      }`}
                      onClick={() => handleDelete(taker.id)}
                    >
                      {deletingId === taker.id
                        ? 'Confirmar exclusão?'
                        : 'Excluir'}
                    </button>
                    {deletingId === taker.id && (
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

export default TakersScreen;
