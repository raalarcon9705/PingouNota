import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('PingouNota could not find the side-panel root element.');
}

createRoot(root).render(
  <StrictMode>
    <main className="panel">
      <header className="panel-header">
        <img src="/icons/icon-48.png" width="40" height="40" alt="" />
        <div>
          <h1>PingouNota</h1>
          <p>Pagamentos e declarações em um só lugar.</p>
        </div>
      </header>
      <section className="card" aria-labelledby="welcome-title">
        <h2 id="welcome-title">Seus pagamentos, organizados</h2>
        <p>
          Acompanhe os recebimentos de Asaas e Husky e organize suas declarações
          de serviço.
        </p>
        <p className="secondary-text">
          Seus dados ficam armazenados localmente neste perfil do Chrome.
        </p>
      </section>
    </main>
  </StrictMode>,
);
