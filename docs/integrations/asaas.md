# Integração Asaas — Mapeamento e Especificação de Seletores

**Última atualização:** 2026-11-19  
**Finalidade:** Especificação de leitura de DOM para o adaptador de conteúdo do Asaas (`asaas.content.ts`).

---

## 1. Origens e Rotas Suportadas

O portal web do Asaas opera nas seguintes origens e padrões de rotas:

- **Origens válidas:**
  - `https://www.asaas.com`
  - `https://app.asaas.com`
- **Padrões de URL para listagem de cobranças/pagamentos:**
  - `/customerPayment/index*`
  - `/customerPayment/list*`
  - `/app/cobranzas*`

A extensão detecta a disponibilidade do portal quando a URL corrente corresponde a qualquer uma dessas rotas e injeta o adaptador de observação.

---

## 2. Seletores de DOM

Os seletores abaixo definem os elementos HTML da listagem de pagamentos. Se o container da tabela não for encontrado na página, o parser emite um aviso estruturado `unsupported_layout` sem interromper a execução.

| Elemento | Seletor CSS Principal | Seletor Alternativo | Descrição |
| :--- | :--- | :--- | :--- |
| **Container da Tabela** | `table[data-testid="payments-table"]` | `table.payments-table, .asaas-payments-table` | Elemento `<table>` principal contendo as cobranças. |
| **Linha de Pagamento** | `tbody tr.payment-row` | `tbody tr[data-payment-id]` | Linha `<tr>` individual correspondente a uma cobrança. |
| **Identificador (ID)** | Atributo `data-payment-id` na `<tr>` | `a.payment-id, [data-field="payment-id"]` | ID único da cobrança no Asaas (ex.: `pay_001` ou `pay_asaas_001`). Se ausente, retorna `null`. |
| **Nome do Pagador** | `[data-field="payer"] .payer-name` | `td[data-field="payer"], .payer-name` | Razão social ou nome do cliente pagador. |
| **Data do Pagamento** | `[data-field="date"]` | `.payment-date, td.date` | Data visível no portal (formato `DD/MM/AAAA`). |
| **Valor Monetário** | `[data-field="amount"]` | `.payment-amount, td.amount` | Valor formatado em reais (ex.: `R$ 2.450,00`). |
| **Badge de Status** | `[data-field="status"] .badge` | `.payment-status, [data-field="status"]` | Texto com o estado operacional da cobrança. |
| **Controle de Próxima Página** | `a.pagination-next[href]` | `a[rel="next"], .pagination .next a` | Link com atributo `href` para a próxima página de resultados. |

---

## 3. Mapeamento de Estados do Pagamento

O estado observado no portal é normalizado estritamente para o domínio interno de 4 estados:

| Texto Visível no Asaas (case-insensitive) | Estado Normalizado (`PaymentState`) | Elegível para Declaração? | Justificativa |
| :--- | :--- | :---: | :--- |
| `Recebido`, `Confirmado`, `Recebida` | `recebido` | **Sim** | Pagamento liquidado e disponível na conta. |
| `Aguardando pagamento`, `Pendente`, `Vencida`, `Aguardando aprovação` | `aguardando_recebimento` | **Não** | Cobrança gerada ou em aberto, recurso ainda não recebido. |
| `Estornado`, `Cancelado`, `Revertido` | `revertido_ou_cancelado` | **Não** | Transação desfeita, cancelada ou devolvida. |
| *Qualquer outro texto não listado* | `desconhecido` | **Não** | Estados desconhecidos nunca são inferidos como recebidos. |

---

## 4. Tratamento de Formatos e Casos Especiais

1. **Moeda e Centavos:**
   - Moeda padrão: `BRL`.
   - Conversão de string (ex.: `"R$ 2.450,00"`) para centavos inteiros (`245000`).
2. **Datas:**
   - Formato padrão brasileiro (`DD/MM/AAAA`), convertido para string ISO ou mantido no formato padrão para indexação.
3. **Identificador Ausente (Edge Case):**
   - Caso uma linha não possua `data-payment-id` nem link com ID extraível, `sourcePaymentId` é definido como `null` e o parser gera `ParseWarning` com código `missing_id`.
   - A identificação da linha receberá `identityConfidence: 'low'`.
4. **Paginador:**
   - Se o link de próxima página existir e possuir atributo `href`, o parser retorna `{ kind: 'next', href: string }`.
   - Se o botão de próxima página estiver desabilitado (ex.: classe `disabled` ou sem `href`), retorna `{ kind: 'end' }`.
   - Se o controle de paginação estiver ausente de forma anômala, retorna `{ kind: 'end' }` ou aviso correspondente.

---

## 5. Política de Privacidade e Sanitização

- Nenhuma credencial, cookie, token de autenticação ou cabeçalho HTTP é salvo.
- As fixtures de teste utilizam exclusivamente identificadores sintéticos (`pay_asaas_*`), empresas fictícias e valores gerados para testes.
