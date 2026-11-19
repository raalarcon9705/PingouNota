# PingouNota 🐧🧾

> Extensão para Google Chrome (Manifest V3) para acompanhar pagamentos recebidos via **Asaas** e **Husky** e reconciliá-los com notas fiscais de serviço (NFS-e), seja marcando localmente ou emitindo diretamente através da API da **Adaflow**.

---

## 🎯 Objetivo do Projeto

O **PingouNota** foi concebido para simplificar a vida de prestadores de serviços e empresas que recebem pagamentos por plataformas como Asaas e Husky. A extensão detecta pagamentos recebidos enquanto você navega pelas páginas dos portais bancários e permite:

1. Visualizar e filtrar pagamentos por status e fornecedor.
2. Associar perfis de tomador de serviços (clientes) e modelos de serviço (CNAE, descrição, retenções).
3. **Marcar como emitida** localmente quando a nota já foi emitida por outro meio.
4. **Emitir NFS-e pela Adaflow** com tela de revisão detalhada e controle de idempotência.
5. Fazer backup e restauração completos em formato JSON.

---

## 🏗️ Arquitetura e Tecnologias

O PingouNota foi construído utilizando práticas modernas para extensões Web com isolamento estrito de segurança:

- **Manifest V3 (MV3):** conformidade com as diretrizes mais recentes do Google Chrome.
- **[WXT](https://wxt.dev/):** framework de última geração para desenvolvimento modular de extensões.
- **React 19 + TypeScript:** interface do usuário segura, tipada e com componentes reutilizáveis.
- **Chrome Side Panel API:** experiência integrada na lateral do navegador, permitindo interagir com o portal e com a extensão simultaneamente.
- **Dexie.js (IndexedDB):** banco de dados local transacional para pagamentos, tomadores, modelos e histórico de operações.
- **chrome.storage.local:** persistência segura de preferências e credenciais locais.

---

## 🔒 Privacidade e Armazenamento 100% Local

A privacidade e a soberania dos seus dados são princípios fundamentais do PingouNota:

- **Zero Servidores Externos do PingouNota:** não existe nenhum servidor, banco de dados ou telemetria mantida pelos criadores do PingouNota.
- **Armazenamento no Navegador:** todos os pagamentos escaneados, dados cadastrais de tomadores e históricos de emissão ficam guardados exclusivamente no perfil do Chrome da sua máquina (`IndexedDB` e `chrome.storage.local`).
- **Comunicação Direta:** as únicas requisições de rede realizadas são diretamente entre o seu navegador e as APIs oficiais da Adaflow (`https://app.adaflow.com`), autenticadas pelo seu próprio token pessoal.
- **Exportação e Limpeza:** você possui controle total para exportar um backup JSON dos seus dados ou apagá-los completamente a qualquer momento.

---

## 📸 Capturas de Tela e Interface (Dados 100% Sintéticos)

> [!NOTE]
> **Aviso de Privacidade e Dados Sintéticos:**
> Todas as capturas de tela, diagramas e ilustrações exibidos na documentação e nos testes do PingouNota utilizam **estritamente dados sintéticos e fictícios** (por exemplo: *"Cliente Exemplo Ltda"*, *"pay_001"*, *"00.000.000/0001-91"*). Nenhuma informação real de clientes, contas bancárias ou credenciais é exposta.

### 1. Painel de Pagamentos (`Side Panel`)
Visualização dos pagamentos detectados nos portais Asaas ou Husky, com filtros por status e seleção em lote:

```text
+-------------------------------------------------------------+
| 🐧 PingouNota                     [Portais: Asaas | Husky]  |
+-------------------------------------------------------------+
| [ Pagamentos (3) ]   [ Tomadores ]   [ Modelos ]  [ Config ] |
+-------------------------------------------------------------+
| Filtrar: [ Todos os status v ]     [ Escanear Portal ]       |
+-------------------------------------------------------------+
| [ ] [ASAAS] Cliente Exemplo Ltda                            |
|     R$ 1.500,00 • Recebido em 15/11/2026                    |
|     Status: [ Pendente de Emissão ]                         |
|     [ Marcar emitida ]  [ Emitir Adaflow ]                  |
+-------------------------------------------------------------+
| [ ] [HUSKY] Global Partner LLC                              |
|     USD 2,000.00 (R$ 11.450,00) • Recebido em 14/11/2026   |
|     Status: [ Emitida (Local) ]                             |
+-------------------------------------------------------------+
| Ações em lote: [ Emitir Selecionados (1) ]                  |
+-------------------------------------------------------------+
```

### 2. Tela de Revisão de Emissão (`IssueReviewScreen`)
Revisão obrigatória de todos os campos fiscais antes de qualquer chamada à API da Adaflow:

```text
+-------------------------------------------------------------+
| <- Voltar          Revisão de Emissão de NFS-e              |
+-------------------------------------------------------------+
| Total a emitir: 1 nota(s) • Total estimado: R$ 1.500,00      |
| Chave Idempotência: gerada automaticamente                  |
+-------------------------------------------------------------+
| Tomador:   Cliente Exemplo Ltda                             |
| CNPJ/CPF:  00.000.000/0001-91                               |
| Valor:     R$ 1.500,00 (BRL)                                |
| CNAE:      6201-5/01 - Desenvolvimento de software custom   |
| Retenções: ISS retido na fonte: [ Não ]                     |
| E-mail:    financeiro@clienteexemplo.com                    |
| Descrição: Serviços de consultoria técnica em TI            |
+-------------------------------------------------------------+
| [ Cancelar (Descarta Rascunho) ]  [ Confirmar e Enviar API ]|
+-------------------------------------------------------------+
```

### 3. Painel de Configurações e Dados (`SettingsScreen` / `DataControls`)
Gerenciamento de credenciais da Adaflow e backup/restauração local:

```text
+-------------------------------------------------------------+
| ⚙️ Configurações e Gerenciamento de Dados                   |
+-------------------------------------------------------------+
| Token de API Adaflow:                                       |
| [ **************************************** ] [ Salvar ]     |
| Status da API: Conectado (v1)                               |
+-------------------------------------------------------------+
| Backup e Restauração Local (JSON):                          |
| • Exportar todos os dados: [ Baixar Backup JSON ]           |
| • Importar backup existente: [ Selecionar Arquivo ]         |
|   (Pré-visualização atômica: mesclar ou substituir dados)   |
+-------------------------------------------------------------+
| Zona de Perigo:                                             |
| [ Apagar Todos os Dados Locais ] (Requer confirmação)       |
+-------------------------------------------------------------+
```

---

## 🔑 Permissões e Justificativas

A extensão solicita apenas as permissões estritamente necessárias para o seu funcionamento:

| Permissão | Justificativa |
| --------- | ------------- |
| `sidePanel` | Permite abrir a interface do PingouNota no painel lateral do Chrome enquanto você visualiza os portais bancários. |
| `storage` | Utilizado para salvar preferências locais do usuário e o token de API da Adaflow em `chrome.storage.local`. |
| `alarms` | Necessário para agendar e executar o polling periódico de status das notas fiscais enviadas à Adaflow em segundo plano. |
| `https://app.adaflow.com/*` | Permite a comunicação direta do background service worker com os endpoints da API da Adaflow (emissão e consulta de NFS-e). |
| `https://www.asaas.com/*` e `https://app.asaas.com/*` | Permite que o content script do PingouNota extraia dados dos pagamentos exibidos na sua tela logada do Asaas. |
| `https://husky.io/*` e `https://app.husky.io/*` | Permite que o content script do PingouNota extraia os dados dos pagamentos e transferências internacionais na sua tela logada da Husky. |

---

## ⚖️ "Marcar como emitida" vs. "Emitir pela Adaflow"

O PingouNota oferece dois modos distintos de conciliação:

### 1. Marcar como emitida (Apenas Local)
- **Zero chamadas à API da Adaflow.**
- Indicado para quando você já emitiu a nota fiscal manualmente pelo portal da prefeitura, por outro sistema ou quando a cobrança não requer emissão.
- Atualiza o status do pagamento apenas no seu banco de dados local como `locally_marked`.

### 2. Emitir pela Adaflow (Emissão Real com Revisão)
- Exibe uma **tela de revisão detalhada** onde você confere tomador, valores (em BRL ou moeda estrangeira), CNAE, descrição e retenções.
- Gera chaves de **idempotência** únicas para garantir que uma nota nunca seja emitida em duplicidade.
- Envia os dados para a API oficial da Adaflow e monitora a autorização da NFS-e.

---

## ⏱️ Controle de Taxa (Rate Limit)

A API da Adaflow impõe restrições de frequência para emissão de notas. Para proteger sua conta contra bloqueios:
- O PingouNota impõe um limite estrito de **no máximo 5 requisições de emissão por minuto móvel** (rolling minute), espaçadas com pelo menos 13 segundos de intervalo entre cada requisição.
- Em caso de resposta `429 Too Many Requests`, a fila pausa automaticamente respeitando o cabeçalho `Retry-After` (ou 60 segundos).

---

## 🚀 Instalação para Desenvolvimento

### Pré-requisitos
- **Node.js**: versão 20 ou 22 (recomendado Node 22+)
- **npm**: v10+
- **Google Chrome** (ou navegador compatível com Chromium com suporte a MV3 Side Panel)

### Passo a passo

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/raalarcon9705/PingouNota.git
   cd PingouNota
   ```

2. **Instale as dependências:**
   ```bash
   npm ci
   ```

3. **Compile a extensão:**
   ```bash
   npm run build
   ```
   *(Para gerar o pacote compactado `.zip`, execute `npm run zip`)*

4. **Carregue no Chrome:**
   - Abra o navegador e acesse `chrome://extensions/`.
   - Ative o **Modo do desenvolvedor** no canto superior direito.
   - Clique em **Carregar sem compactação** (Load unpacked).
   - Selecione a pasta `.output/chrome-mv3` gerada no projeto.
   - Fixe o ícone do **PingouNota** na barra de ferramentas do Chrome e abra o painel lateral!

---

## ⚙️ Configuração do Token Adaflow

1. Abra a extensão no Side Panel.
2. Clique na aba de **Configurações** (ícone de engrenagem).
3. No campo **Token da Adaflow**, insira seu token de API obtido no painel da Adaflow.
4. Clique em **Salvar**. O token será validado e salvo de forma segura no seu `chrome.storage.local`.

---

## ⚠️ Limitações Conhecidas

- **Rotas suportadas e visíveis:** A extração de dados ocorre exclusivamente quando o usuário navega ativamente pelas telas de cobrança/pagamentos do Asaas ou Husky. O PingouNota não faz scraping oculto, não armazena suas senhas nem realiza login automatizado.
- **Estruturas de DOM:** Alterações drásticas no layout ou no código-fonte das páginas do Asaas e Husky podem exigir atualizações nos seletores de captura do content script.

---

## 📄 Licença

Este projeto é distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.

Copyright (c) 2026 raalarcon9705.
