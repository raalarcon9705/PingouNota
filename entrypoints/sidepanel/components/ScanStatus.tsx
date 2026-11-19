import React from 'react';
import type { ScanStatus as ScanStatusType } from '../../../src/services/scan-coordinator';

export type PortalSourceState = 'supported' | 'unsupported-origin' | 'source-unavailable';

export interface ScanStatusProps {
  status?: ScanStatusType;
  reason?: string | null;
  pagesSeen?: number;
  recordsFound?: number;
  sourceState?: PortalSourceState;
  sourceStateMessage?: string | null;
}

export const ScanStatus: React.FC<ScanStatusProps> = ({
  status = 'idle',
  reason,
  pagesSeen = 0,
  recordsFound = 0,
  sourceState = 'supported',
  sourceStateMessage,
}) => {
  if (sourceState === 'source-unavailable') {
    return (
      <div
        className="banner banner-danger banner-source-unavailable"
        role="alert"
        aria-live="assertive"
        data-testid="view-source-unavailable"
      >
        <div className="banner-content">
          <strong>Portal indisponível</strong>
          <p>
            {sourceStateMessage ||
              'Não foi possível conectar ao portal de pagamentos. Verifique se você está autenticado.'}
          </p>
        </div>
      </div>
    );
  }

  if (sourceState === 'unsupported-origin') {
    return (
      <div
        className="banner banner-warning banner-unsupported-origin"
        role="region"
        aria-label="Origem não suportada"
        data-testid="view-unsupported-origin"
      >
        <div className="banner-content">
          <strong>Origem não suportada</strong>
          <p>
            Abra o portal do Asaas (asaas.com) ou da Husky (husky.io) para detectar e conciliar seus pagamentos.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'idle' || status === 'complete') {
    return null;
  }

  if (status === 'partial') {
    return (
      <div className="banner banner-warning" role="alert" aria-live="assertive">
        <div className="banner-content">
          <strong>Sincronização parcial</strong>
          <p>
            {reason ||
              'A sincronização não alcançou todas as páginas. Alguns pagamentos podem estar ausentes.'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'scanning') {
    return (
      <div className="banner banner-info" role="status" aria-live="polite">
        <div className="banner-content">
          <strong>Sincronizando pagamentos...</strong>
          <p>
            {pagesSeen} página(s) lida(s), {recordsFound} pagamento(s) identificado(s).
          </p>
        </div>
      </div>
    );
  }

  if (status === 'paused') {
    return (
      <div className="banner banner-warning" role="alert">
        <div className="banner-content">
          <strong>Sincronização pausada</strong>
          <p>{reason || 'A sincronização foi pausada devido à interação do usuário.'}</p>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="banner banner-danger" role="alert">
        <div className="banner-content">
          <strong>Falha na sincronização</strong>
          <p>{reason || 'Não foi possível concluir a leitura dos pagamentos.'}</p>
        </div>
      </div>
    );
  }

  return null;
};

export default ScanStatus;
