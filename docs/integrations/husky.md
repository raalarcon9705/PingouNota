# Integração Husky — Mapeamento e Especificação de Seletores

**Última atualização:** 2026-11-19  
**Finalidade:** Especificação de leitura de DOM para o adaptador de conteúdo do Husky (`husky.content.ts`).

---

## 1. Origens e Rotas Suportadas

O portal web do Husky (Nomad Fintech / Husky) opera nas seguintes origens e padrões de rotas:

- **Origens válidas:**
  - `https://app.husky.io`
  - `https://husky.io`
- **Padrões de URL para listagem de transferências:**
  - `/transfers*`
  - `/payments*`
  - `/app/transfers*`
  - `/dashboard*`

A extensão detecta a disponibilidade do portal quando a URL corrente corresponde a qualquer uma dessas rotas e injeta o adaptador de observação.

---

## 2. Seletores de DOM

Os seletores abaixo definem os elementos HTML da listagem de transferências internacionais. Se o container da listagem não for encontrado, o parser emite um aviso estruturado `unsupported_layout`.

| Elemento | Seletor CSS Principal | Seletor Alternativo | Descrição |
| :--- | :--- | :--- | :--- |
| **Container da Lista** | `[data-testid="transfers-list"]` | `.transfers-container, .husky-transfers-list` | Container pai contendo os cards/linhas de transferências. |
| **Linha / Card de Transferência** | `article.transfer-card` | `div.transfer-row, div[data-transfer-id]` | Card ou linha individual de transferência. |
| **Identificador (ID)** | Atributo `data-transfer-id` no card | `.transfer-id, [data-field="transfer-id"]` | ID único da transferência no Husky (ex.: `tra_husky_101`). Se ausente, retorna `null`. |
| **Remetente / Pagador** | `[data-field="sender"] .transfer-sender` | `[data-field="sender"], .transfer-sender` | Nome da empresa estrangeira ou pagador remetente. |
| **Data da Transferência** | `[data-field="date"]` | `.transfer-date` | Data visível (formato `DD/MM/AAAA` ou ISO/padrão). |
| **Valor e Moeda** | `[data-field="amount"] .transfer-amount` | `[data-field="amount"], .transfer-amount` | Texto com código de moeda e valor (ex.: `USD 4,200.00` ou `EUR 2,500.00`). |
| **Badge de Status** | `[data-field="status"]` | `.transfer-status, .badge` | Texto indicando o estado atual da transferência no Husky. |
| **Controle de Próxima Página** | `a.pagination-next[href]` | `a[rel="next"], [data-testid="pagination-next"]` | Link com atributo `href` para carregar páginas adicionais. |

---

## 3. Mapeamento de Estados do Pagamento

O estado observado no Husky é normalizado para o domínio interno de 4 estados. **Apenas transferências com liquidação concluída na conta são mapeadas para `recebido`**. Transferências a caminho ou em processamento são estritamente mantidas como `aguardando_recebimento`:

| Texto Visível no Husky (case-insensitive) | Estado Normalizado (`PaymentState`) | Elegível para Declaração? | Justificativa |
| :--- | :--- | :---: | :--- |
| `Na conta`, `Concluído`, `Disponível`, `Arrived` | `recebido` | **Sim** | O dinheiro já chegou na conta e foi creditado/liquidado. |
| `A caminho`, `Em processamento`, `In transit`, `Processando` | `aguardando_recebimento` | **Não** | Transferência internacional em trânsito; não liquidada. |
| `Cancelado`, `Devolvido`, `Revertido` | `revertido_ou_cancelado` | **Não** | Transferência cancelada ou estornada pelo remetente/banco. |
| *Qualquer outro texto não listado* | `desconhecido` | **Não** | Rótulos ambíguos ou em análise de compliance nunca são inferidos como recebidos. |

---

## 4. Tratamento de Formatos e Casos Especiais

1. **Moeda Estrangeira e Centavos:**
   - Moedas suportadas: `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `BRL`.
   - Extração do código ISO da moeda a partir da string (ex.: `"USD 4,200.00"` -> currency `"USD"` e `420000` centavos).
2. **Datas:**
   - Formato padrão brasileiro (`DD/MM/AAAA`) ou padrão internacional documentado.
3. **Identificador Ausente (Edge Case):**
   - Caso um card não possua `data-transfer-id` nem texto de ID, `sourcePaymentId` é definido como `null` e o parser gera `ParseWarning` com código `missing_id`.
   - A identificação da linha receberá `identityConfidence: 'low'`.
4. **Paginador:**
   - Se houver link com `href` para a próxima página, retorna `{ kind: 'next', href: string }`.
   - Se for o final da listagem ou botão desabilitado, retorna `{ kind: 'end' }`.

---

## 5. Política de Privacidade e Sanitização

- Nenhum cookie, token de sessão, chave de API bancária ou dado pessoal sensível é coletado.
- As fixtures utilizam nomes fictícios de empresas estrangeiras e identificadores sintéticos (`tra_husky_*`).
