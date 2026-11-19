import React from 'react';
import type { ScanStatus as ScanStatusType } from '../../../src/services/scan-coordinator';

export interface ScanStatusProps {
  status?: ScanStatusType;
  reason?: string | null;
  pagesSeen?: number;
  recordsFound?: number;
}

export const ScanStatus: React.FC<ScanStatusProps> = ({
  status = 'idle',
  reason,
  pagesSeen = 0,
  recordsFound = 0,
}) => {
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
