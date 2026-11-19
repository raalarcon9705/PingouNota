# PingouNota MVP Implementation Plan

> **For agentic workers:** Execute this plan task by task. Keep changes scoped to one worktree and commit each completed task. Create the public GitHub repository only in the final publishing task, after the local extension package is complete.

**Goal:** Build a public, MIT-licensed Chrome extension that detects Asaas and Husky payments, tracks pending and received funds locally, and supports local declaration marking or real NFSe issuance through Adaflow.

**Architecture:** Use Manifest V3 through WXT with React and TypeScript. Content scripts read the two payment portals and send normalized observations to an extension service worker; the service worker owns persistence, Adaflow calls, idempotency, rate limiting, and polling. A React Chrome side panel presents the Portuguese Brazilian workflow, with IndexedDB for structured local records and chrome.storage.local for the Adaflow token and small preferences.

**Tech Stack:** WXT, React, TypeScript, Chrome Side Panel API, Dexie/IndexedDB, chrome.storage.local, Zod for imported/API data validation, Vitest for domain and UI behavior, MIT license.

---

## File and module map

| Path | Responsibility |
|---|---|
| wxt.config.ts | WXT modules and Manifest V3 permissions, host matches, side-panel entry, and action metadata. |
| entrypoints/background.ts | Service-worker message routing, badge state, alarms, storage access level, and lifecycle coordination. |
| entrypoints/asaas.content.ts | Read-only Asaas DOM adapter and supported-list detection. |
| entrypoints/husky.content.ts | Read-only Husky DOM adapter and supported-list detection. |
| entrypoints/sidepanel/index.html, main.tsx, App.tsx | Side-panel document and React mount/root navigation. |
| entrypoints/sidepanel/components/ | Payment list, filters, batch toolbar, confirmation/review forms, empty/error states. |
| entrypoints/sidepanel/screens/ | Payments, templates, takers, and settings views. |
| entrypoints/sidepanel/styles.css | Responsive side-panel styling, design tokens, focus, contrast, and reduced motion. |
| src/domain/ | Payment, declaration, taker, template, NFSe operation types and state transitions. |
| src/storage/database.ts | Dexie schema, indexes, migrations, and repository operations. |
| src/services/scan-coordinator.ts | Scan progress, deduplication/upsert flow, safe pagination, and visible-page fallback. |
| src/services/adaflow/client.ts | Authenticated Adaflow request/response mapping and error handling. |
| src/services/adaflow/emission-queue.ts | Persisted per-payment issue queue, idempotency keys, pacing, and status polling. |
| src/services/templates.ts | Template rendering, payment-derived defaults, and payload validation. |
| src/services/backup.ts | Versioned JSON export/import, preview, validation, and merge behavior. |
| src/shared/messages.ts | Typed content-script/service-worker/side-panel message contracts. |
| tests/fixtures/ | Sanitized Asaas and Husky DOM fixtures, with synthetic customer/payment data only. |
| tests/ | Vitest domain, storage, parser, queue, backup, and component tests. |
| public/icons/ | Extension icons in Chrome-required sizes. |
| README.md, LICENSE, SECURITY.md, .gitignore, .editorconfig | Public project documentation, MIT terms, safe repository defaults. |
| .github/workflows/ci.yml | Install dependencies, run automated tests, and build the Chrome extension on pull requests and pushes to main. |

The entrypoint structure follows WXT's file-based extension layout; WXT supports a sidepanel entrypoint and generates the corresponding MV3 manifest. See [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints) and [React module](https://wxt.dev/guide/essentials/frontend-frameworks). Chrome's Side Panel API is an MV3 API and opens from the action click, matching the approved interaction. See [Chrome side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) and [manifest format](https://developer.chrome.com/docs/extensions/reference/manifest). GitHub documents that public repositories can use rulesets and private vulnerability reporting on the Free plan: [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) and [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Task 1: Scaffold the extension and public project defaults

**Files:**
- Create: package.json
- Create: wxt.config.ts
- Create: tsconfig.json
- Create: .gitignore
- Create: .editorconfig
- Create: LICENSE
- Create: public/icons/icon-16.png, public/icons/icon-32.png, public/icons/icon-48.png, public/icons/icon-128.png
- Create: entrypoints/sidepanel/index.html
- Create: entrypoints/sidepanel/main.tsx
- Create: entrypoints/sidepanel/styles.css

- [x] **Step 1: Install the extension toolchain**

Run from the repository root:

~~~bash
npm install react react-dom dexie zod
npm install --save-dev wxt @wxt-dev/module-react typescript @types/chrome @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/jest-dom
~~~

- [x] **Step 2: Define the package scripts**

Set scripts in package.json to dev: wxt, build: wxt build, zip: wxt zip, test: vitest run, test:watch: vitest, and postinstall: wxt prepare. Keep the package name pingounota, package version 0.1.0, and type module.

- [x] **Step 3: Configure WXT for Chrome MV3 and React**

In wxt.config.ts, enable @wxt-dev/module-react; configure the Chrome manifest with name PingouNota, version 0.1.0, side panel sidepanel.html, the action title in pt-BR, and only sidePanel, storage, and alarms permissions plus the Adaflow host permission. Task 2 adds the exact Asaas and Husky origins after inspecting the authenticated pages. Do not request tabs, scripting, or broad <all_urls> permissions unless a documented portal requirement proves necessary.

- [x] **Step 4: Establish the side-panel entrypoint and style tokens**

Create a valid lang="pt-BR" HTML entrypoint and mount React from main.tsx. Define CSS custom properties for an Apple-system font stack, spacing, system colors, focus rings, separators, card surfaces, and light/dark color schemes. Include prefers-reduced-motion behavior. Use semantic HTML and visible text labels; do not rely on icon-only controls.

- [x] **Step 5: Build the extension package and commit**

Run npm run build. Confirm WXT emits a Manifest V3 package with a side-panel entry and no broad host permissions. Commit as chore: scaffold PingouNota Chrome extension.

## Task 2: Inspect portal pages and establish sanitized fixtures

**Files:**
- Create: docs/integrations/asaas.md
- Create: docs/integrations/husky.md
- Create: tests/fixtures/asaas-payments.html
- Create: tests/fixtures/husky-payments.html
- Modify: wxt.config.ts

- [x] **Step 1: Inspect the authenticated Asaas payment list**

Record only the origin, payment-list route, row container, payment-ID source, exact received/pending/refunded labels, and next-page control. Do not save customer names, documents, addresses, amounts, cookies, or page storage.

- [x] **Step 2: Inspect the authenticated Husky payment list**

Record only the origin, payment-list route, row container, payment-ID source, exact in-transit/arrived/reversed labels, and next-page control. Do not save customer names, documents, addresses, amounts, cookies, or page storage.

- [x] **Step 3: Write the Asaas integration note and sanitized fixture**

Document exact supported route patterns and map visible status strings to aguardando_recebimento, recebido, revertido_ou_cancelado, or desconhecido. Replace all portal data in the fixture with synthetic IDs, names, and amounts.

- [x] **Step 4: Write the Husky integration note and sanitized fixture**

Document exact supported route patterns and map to recebido only when the page clearly indicates the transfer has arrived. Keep in-transit labels pending. Replace all customer and payment data in the fixture with synthetic values.

- [x] **Step 5: Restrict the host permissions**

Update WXT host permissions to the exact Asaas and Husky origins discovered above. Keep Adaflow restricted to https://app.adaflow.com/*. The content-script route match patterns are configured in Task 4 from the same integration notes.

- [x] **Step 6: Review fixtures for sensitive data and commit**

Inspect each fixture for CPF/CNPJ, email, address, cookies, or any real customer value and remove it. Commit as docs: define sanitized Asaas and Husky integration fixtures.

## Task 3: Define domain states and local database

**Files:**
- Create: src/domain/payment.ts
- Create: src/domain/declaration.ts
- Create: src/domain/taker.ts
- Create: src/domain/template.ts
- Create: src/domain/nfse-operation.ts
- Create: src/storage/database.ts
- Create: src/storage/payment-repository.ts
- Create: tests/domain/payment-state.test.ts
- Create: tests/storage/payment-repository.test.ts
- Create: vitest.config.ts

- [x] **Step 1: Define the normalized payment types**

Represent money as integer cents plus an ISO currency code. Put Payment, PaymentProvider, and PaymentState in src/domain/payment.ts; TakerProfile and AdaflowServiceTaker in taker.ts; ServiceTemplate in template.ts; and NfseIssuePayload/NfseOperation in nfse-operation.ts. Use these exported shapes as the shared baseline; add non-secret metadata fields only when required by the spec:

~~~ts
export type PaymentProvider = 'asaas' | 'husky';
export type PaymentState = 'aguardando_recebimento' | 'recebido' | 'revertido_ou_cancelado' | 'desconhecido';

export interface Payment {
  provider: PaymentProvider;
  recordKey: string;
  sourcePaymentId: string | null;
  identityConfidence: 'high' | 'low';
  ambiguousIdentity: boolean;
  identityFingerprint: string | null;
  payerName: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentDate: string | null;
  sourceStatus: string;
  paymentState: PaymentState;
  declarationState: 'nao_declarado' | 'marcado_localmente' | 'emissao_solicitada' | 'emitida_adaflow' | 'falha_adaflow' | 'cancelada_adaflow';
  lastObservedAt: string;
  manualDeclaredAt: string | null;
}

export interface TakerProfile {
  id: string;
  name: string;
  document: string | null;
  externalId: string | null;
  email: string | null;
  address: { line1: string; number: string | null; neighborhood: string | null; city: string; state: string; postalCode: string; country: string };
}

export interface AdaflowServiceTaker {
  document?: string;
  external_id?: string;
  name?: string;
  email?: string;
  address?: { line1: string; number?: string; neighborhood?: string; city: string; state: string; postal_code: string; country?: string };
}

export interface ServiceTemplate {
  id: string;
  name: string;
  cnae: string;
  description: string;
  withholdTaxes: boolean;
  forwardingEmail: string | null;
}

export interface NfseIssuePayload {
  cnae: string;
  description: string;
  value_cents?: number;
  foreign_value_cents?: number;
  foreign_value_currency?: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
  withhold_taxes: boolean;
  forwarding_email?: string;
  external_id: string;
  service_taker: AdaflowServiceTaker;
}

export interface NfseOperation {
  id: string;
  provider: 'asaas' | 'husky';
  paymentRecordKey: string;
  externalId: string;
  idempotencyKey: string;
  payloadJson: string;
  adaflowNfseId: number | null;
  status: 'queued' | 'requested' | 'issued' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}
~~~

Store provider, local record key, nullable portal payment ID, identity confidence/fingerprint/ambiguity, source status label, payer fields read from the page, payment date, last observed time, normalized arrival state, declaration state, and optional manual-declaration timestamp. Keep the four payment states and six declaration states as the literal unions shown above. The local taker type and API taker type are separate so address field naming is converted only at the API boundary.

- [x] **Step 2: Add state-transition functions and focused tests**

Create pure functions that allow declaring only recebido with unambiguous identity; prevent a portal refresh from erasing declaration history; flag a reversal after declaration for review; and treat unrecognized source states as desconhecido. Test each transition, including ambiguous composite identity, with synthetic values.

- [x] **Step 3: Define taker, template, and operation schemas**

Use Zod schemas for Brazilian documents, service addresses, template fields, and the frozen NFSe request. Validate that a new Brazilian taker has document, name, and all required address fields before submission. Validate supported foreign currency codes.

- [x] **Step 4: Create Dexie tables and indexes**

Create payments keyed by [provider+recordKey], takers keyed by a normalized local key, templates keyed by ID, nfseOperations keyed by operation ID with unique idempotency key, and metadata for backup schema version. Add indexes for provider, normalized payment state, declaration state, and received date.

- [x] **Step 5: Implement repository upserts and tests**

Upserting an observed payment must preserve declarationState, manualDeclaredAt, and the linked NFSe operation unless those fields are explicitly changed by a declaration operation. Match high-confidence rows by portal ID and unique low-confidence rows by composite recordKey; never auto-merge ambiguous rows. Test duplicate observations, ambiguous composite collisions, and source updates.

- [x] **Step 6: Run focused tests and commit**

Run npm run test -- tests/domain/payment-state.test.ts tests/storage/payment-repository.test.ts. Commit as feat: add local payment and declaration model.

## Task 4: Build the content-script message boundary and portal adapters

**Files:**
- Create: src/shared/messages.ts
- Create: src/shared/observed-payment.ts
- Create: src/services/scan-coordinator.ts
- Create: entrypoints/asaas.content.ts
- Create: entrypoints/husky.content.ts
- Create: tests/parsers/asaas-parser.test.ts
- Create: tests/parsers/husky-parser.test.ts
- Create: entrypoints/background.ts

- [x] **Step 1: Define the shared parser and message contracts**

Put these exact contracts in src/shared/observed-payment.ts and src/shared/messages.ts so both portal adapters, the service worker, and storage use one shape:

~~~ts
import type { PaymentProvider, PaymentState } from '../domain/payment';

export interface ObservedPayment {
  provider: PaymentProvider;
  sourcePaymentId: string | null;
  identityConfidence: 'high' | 'low';
  payerName: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentDate: string | null;
  sourceStatus: string;
  paymentState: PaymentState;
}

export interface ParseWarning {
  code: 'missing_id' | 'missing_amount' | 'unknown_status' | 'unsupported_layout';
  message: string;
  rowIndex: number | null;
}

export interface ParseResult {
  payments: ObservedPayment[];
  warnings: ParseWarning[];
  pagination: { kind: 'next'; href: string } | { kind: 'end' } | { kind: 'unsupported'; reason: string };
}

export interface ScanProgress {
  scanId: string;
  provider: PaymentProvider;
  status: 'scanning' | 'partial' | 'complete' | 'paused' | 'failed';
  pagesSeen: number;
  recordsFound: number;
  reason: string | null;
}

export type ExtensionMessage =
  | { type: 'PORTAL_LIST_DETECTED'; provider: PaymentProvider; pageUrl: string }
  | { type: 'PAYMENTS_OBSERVED'; scanId: string; pageUrl: string; result: ParseResult }
  | { type: 'SCAN_CONTROL'; action: 'start' | 'pause' | 'cancel'; scanId?: string; provider: PaymentProvider }
  | { type: 'SCAN_PROGRESS'; progress: ScanProgress }
  | { type: 'ISSUE_QUEUE_START'; operationIds: string[] }
  | { type: 'ISSUE_QUEUE_PROGRESS'; operationIds: string[] };
~~~

Define parser signatures as parseAsaasPayments(document: Document): ParseResult and parseHuskyPayments(document: Document): ParseResult. The scan coordinator adds observation timestamps. Validate incoming messages with Zod in the service worker before storage. Do not pass the Adaflow token or API payload to a content script.

Export a Zod schema named extensionMessageSchema matching ExtensionMessage and use safeParse before any repository write.

Keep these contracts in their named files: ObservedPayment/ParseWarning/ParseResult in src/shared/observed-payment.ts, and ScanProgress/ExtensionMessage/extensionMessageSchema in src/shared/messages.ts. Side-panel scan controls send SCAN_CONTROL; the service worker broadcasts SCAN_PROGRESS. A supported content script sends PORTAL_LIST_DETECTED and PAYMENTS_OBSERVED. A confirmed issue review sends ISSUE_QUEUE_START, and the service worker broadcasts ISSUE_QUEUE_PROGRESS.

- [x] **Step 2: Parse Asaas rows and stable IDs**

Implement a row selector and extract sourcePaymentId and payerName using only the selectors recorded in docs/integrations/asaas.md. Return an unsupported_layout warning when the expected list container is absent. When no portal ID exists, set sourcePaymentId to null and add missing_id; createRecordIdentity in the scan coordinator handles the composite key.

- [x] **Step 3: Parse Asaas money, date, status, and pagination**

Add localized amount/date parsing and the exact source-status mapping from docs/integrations/asaas.md. Return unknown status as desconhecido and expose the typed pagination state without navigating. Run the Asaas parser test file against the sanitized fixture.

- [x] **Step 4: Parse Husky rows and stable IDs**

Implement a row selector and extract sourcePaymentId and payerName using only the selectors recorded in docs/integrations/husky.md. Return an unsupported_layout warning when the expected list container is absent. When no portal ID exists, set sourcePaymentId to null and add missing_id; createRecordIdentity handles the composite key.

- [x] **Step 5: Parse Husky money, date, status, and pagination**

Add localized amount/date parsing and the exact source-status mapping from docs/integrations/husky.md. Keep in-transit transfers pending; only the verified arrived/credited UI state maps to recebido. Expose typed pagination state without navigating.

- [x] **Step 6: Add fixture tests for both parsers**

Cover recognized statuses, pending versus received, unknown status, missing ID, localized amount formats, multiple rows, empty lists, and the distinct pagination results next/end/unsupported for both providers. Use only the sanitized HTML files. Run npm run test -- tests/parsers/asaas-parser.test.ts tests/parsers/husky-parser.test.ts.

- [x] **Step 7: Route observations through the service worker**

Register WXT content scripts only on the supported payment-list routes. Send observed data to the background service worker; validate it; call payment-repository.upsertObservedPayments; and update the action badge with a count of newly received, undeclared payments.

- [x] **Step 8: Run parser tests and commit**

Run npm run test -- tests/parsers/asaas-parser.test.ts tests/parsers/husky-parser.test.ts. Commit as feat: detect Asaas and Husky payments.

## Task 5: Add history scanning, progress, and safe fallback

**Files:**
- Modify: src/services/scan-coordinator.ts
- Modify: entrypoints/asaas.content.ts
- Modify: entrypoints/husky.content.ts
- Modify: src/shared/messages.ts
- Create: tests/services/scan-coordinator.test.ts

- [x] **Step 1: Define scan and pagination contracts**

In src/services/scan-coordinator.ts define ScanStatus as idle | scanning | partial | complete | paused | failed and ScanResult with scanId, provider, status, pagesSeen, recordsFound, reason, and restoreStatus. Define provider adapters with parse(document): ParseResult and nextPage(document): PaginationResult, where PaginationResult is { kind: 'next'; href: string } | { kind: 'end' } | { kind: 'unsupported'; reason: string }. Persist only scan metadata, never HTML. On PORTAL_LIST_DETECTED, the service worker automatically starts a full scan if none completed for that provider; after completion, later visits start incremental scans. If the full scan is partial, the next visit resumes a full scan.

- [x] **Step 2: Implement list-page progression**

For each provider, read the next-page target only from the documented ordinary list control. Return end when the page explicitly indicates there is no next page; return unsupported with a reason when pagination cannot be identified. Reject targets outside the matching portal origin or payment-list route.

- [x] **Step 3: Build reliable payment identity**

Implement createRecordIdentity(observation, scanOccurrences, existingMatches) with this contract:

~~~ts
import type { Payment } from '../domain/payment';
import type { ObservedPayment } from '../shared/observed-payment';

export interface RecordIdentity {
  recordKey: string;
  identityFingerprint: string | null;
  identityConfidence: 'high' | 'low';
  ambiguousIdentity: boolean;
}

export function createRecordIdentity(
  observation: ObservedPayment,
  scanOccurrences: number,
  existingMatches: Payment[],
): Promise<RecordIdentity>;
~~~

Use provider plus sourcePaymentId with high confidence when the portal ID exists. Without it, use Web Crypto SHA-256 over provider + normalized payer name + ISO payment date + amount cents + currency as the composite fingerprint and low-confidence record key only when the fingerprint is unique in the scan and database. If multiple rows share it, assign separate ambiguous local keys, flag all matching rows ambiguous, and do not merge, mark, or issue them automatically. Display low-confidence identity distinctly.

- [x] **Step 4: Mark scan-owned navigation**

Before navigation, persist scanId and expected target. Pause if a click, keypress, or form interaction originates from the user, or if the active URL changes to a route other than the expected scan target. Never click submit, filter, payment, or destructive controls.

- [x] **Step 5: Restore the starting view safely**

Restore the starting URL/filter only if the tab is still on the scan-owned route and no user interaction occurred. If unsafe or restoration fails, stop without another navigation and return status partial with restoreStatus failed.

- [x] **Step 6: Implement visible-page fallback and user controls**

When pagination is unsupported or navigation is unsafe, save current observations, mark the scan partial, and expose pause/cancel controls. When pagination returns end, mark the scan complete. Retrying a partial scan starts from the current visible page and does not repeat unsafe navigation.

- [x] **Step 7: Test scan outcomes and commit**

Test complete, partial, paused, cancelled, unsafe-navigation, failed restoration, unique composite identity, and ambiguous fingerprint outcomes with fake adapters. Run npm run test -- tests/services/scan-coordinator.test.ts. Commit as feat: scan payment history with visible-page fallback.

## Task 6: Build the pt-BR side-panel payment experience

**Files:**
- Modify: entrypoints/background.ts
- Create: entrypoints/sidepanel/App.tsx
- Create: entrypoints/sidepanel/screens/PaymentsScreen.tsx
- Create: entrypoints/sidepanel/components/PaymentRow.tsx
- Create: entrypoints/sidepanel/components/PaymentFilters.tsx
- Create: entrypoints/sidepanel/components/ScanStatus.tsx
- Modify: entrypoints/sidepanel/styles.css
- Create: tests/ui/payments-screen.test.tsx

- [x] **Step 1: Set the toolbar action to open the side panel**

In the service worker, call chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }). Show a badge only when a content script detects a supported portal. On other sites the side panel shows a concise help state directing the user to Asaas or Husky. Do not call sidePanel.open() from navigation events.

- [x] **Step 2: Add the summary cards**

Create a typed summary selector that counts aguardando_recebimento and recebido independently. Test counts against a synthetic set containing every payment state; run npm run test -- tests/ui/payments-screen.test.tsx.

- [x] **Step 3: Add provider and state filters**

Create labeled controls for all providers and normalized payment/declaration states. Keep the selected filters in React state; test that each filter returns only matching rows.

- [x] **Step 4: Render payment rows and clear states**

Render payer, amount, received date, provider, source state, and declaration state. Add loading, empty, partial-scan, unsupported-origin, and source-unavailable views in pt-BR. Sort received undeclared payments first, then newest received date.

- [x] **Step 5: Add accessible multi-selection**

Only recebido payments with unambiguous identity in nao_declarado can be selected for a first declaration. An item in falha_adaflow can be retried only from its operation details after correcting the actionable error and creating a new reviewed operation. Keep pending, reversed, unknown, ambiguous identity, already locally marked, active requested, and already issued items unselectable, with a clear reason in the row. Test checkbox labels and disabled states.

- [x] **Step 6: Review responsive and accessible styling**

Check the 320px panel width, light/dark color schemes, contrast, keyboard-visible focus, reduced-motion CSS, and 44px minimum controls. Run npm run test -- tests/ui/payments-screen.test.tsx.

- [x] **Step 7: Build and commit the panel**

Run npm run build. Commit as feat: add Portuguese payment side panel.

## Task 7: Implement local declaration marking and templates/takers UI

**Files:**
- Create: src/services/templates.ts
- Create: entrypoints/sidepanel/screens/TemplatesScreen.tsx
- Create: entrypoints/sidepanel/screens/TakersScreen.tsx
- Create: entrypoints/sidepanel/components/LocalMarkDialog.tsx
- Create: entrypoints/sidepanel/components/TemplateEditor.tsx
- Create: entrypoints/sidepanel/components/TakerForm.tsx
- Create: tests/services/templates.test.ts
- Create: tests/ui/local-mark-dialog.test.tsx

- [x] **Step 1: Implement template rendering**

Render {{mes}} and {{ano}} using the payment's received date in the browser locale; expose the rendered description for editing before issue. Pull amount/currency from the payment. Preserve CNAE, withhold_taxes, and forwarding email from the selected template.

- [x] **Step 2: Implement local taker profile forms**

Allow creating/editing/selecting a locally saved service taker. Require CPF/CNPJ, name, and complete Brazilian address for a new Brazilian taker. Validate fields inline and retain entered data when validation fails.

- [x] **Step 3: Implement the local-mark confirmation**

Use the approved disclaimer verbatim. Confirming one or many received payments writes marcado_localmente and a timestamp to the local database only; it must not call the Adaflow client. Show a completion summary with the count marked.

- [x] **Step 4: Test template output and local-only behavior**

Test placeholder rendering, custom description overrides, required taker fields, multi-mark timestamping, and that the dialog uses no Adaflow service. Run npm run test -- tests/services/templates.test.ts tests/ui/local-mark-dialog.test.tsx.

- [x] **Step 5: Commit**

Commit as feat: add local declaration and service templates.

## Task 8: Add Adaflow settings and API client

**Files:**
- Create: src/services/adaflow/client.ts
- Create: src/services/adaflow/errors.ts
- Create: entrypoints/sidepanel/screens/SettingsScreen.tsx
- Modify: entrypoints/background.ts
- Modify: wxt.config.ts
- Create: tests/services/adaflow-client.test.ts

- [x] **Step 1: Add local token settings**

Provide a password-style token field with show/hide control, save/delete actions, and pt-BR copy directing users to Adaflow Integrações. Do not add a fake test-connection action because the supplied OpenAPI has no authentication-only endpoint. Use chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }) before reading the token; only the background service worker may read it.

- [x] **Step 2: Implement the typed client**

Implement createNfse(payload, idempotencyKey) for POST https://app.adaflow.com/api/v1/nfses with JSON body { nfse: payload }, getNfse(id) for GET /nfses/{id}, and getNfseByExternalId(externalId) for GET /nfses/by-external-id/{external_id}. Add bearer auth, JSON content type, Idempotency-Key on POST, response validation, timeout handling, and mapping for 401/404/422/429/500 responses. URL-encode IDs in path segments. Keep all fetch calls in the background context.

- [x] **Step 3: Add client tests using mocked fetch**

Cover URL, auth header, idempotency header, each endpoint, success responses, validation errors, 401, 404, 429, timeout, malformed JSON, and status parsing. Run npm run test -- tests/services/adaflow-client.test.ts.

- [x] **Step 4: Build and commit**

Run npm run build. Commit as feat: add Adaflow API configuration and client.

## Task 9: Add reviewed real issuance and rate-limited batch queue

**Files:**
- Create: src/services/adaflow/emission-queue.ts
- Create: entrypoints/sidepanel/screens/IssueReviewScreen.tsx
- Create: entrypoints/sidepanel/components/IssueReviewRow.tsx
- Create: entrypoints/sidepanel/screens/OperationsScreen.tsx
- Modify: entrypoints/background.ts
- Create: tests/services/emission-queue.test.ts
- Create: tests/ui/issue-review-screen.test.tsx

- [x] **Step 1: Build and validate an NFSe payload**

Expose a pure function with this signature in src/services/adaflow/emission-queue.ts:

~~~ts
import type { Payment } from '../../domain/payment';
import type { ServiceTemplate } from '../../domain/template';
import type { NfseIssuePayload } from '../../domain/nfse-operation';
import type { TakerProfile } from '../../domain/taker';

export function buildNfseIssuePayload(
  payment: Payment,
  template: ServiceTemplate,
  taker: TakerProfile,
  descriptionOverride?: string,
): NfseIssuePayload;
~~~

Validate required fields and exactly one of value_cents or foreign_value_cents. Accept only Adaflow's documented foreign currencies.

- [x] **Step 2: Keep reviewed payloads as unsent drafts**

Store validated payloads only in the review screen's draft state. Do not create an NfseOperation or idempotency key while the user is still reviewing. Canceling review must leave no operation in IndexedDB.

- [x] **Step 3: Render each issue review row**

For each item, display taker name/document, amount and currency, CNAE, description, withholding setting, and forwarding email. Show inline validation errors and block only the invalid item; all valid rows remain reviewable.

- [x] **Step 4: Persist and enqueue after explicit confirmation**

Add a separate confirmation action that reports the number of valid NFSes and total BRL value when comparable. Only after confirmation, create an operation ID for each item, generate its idempotency key, build an external_id from provider + payment record key + operation ID, persist the frozen payload and queued status, and send the queue-start message. Test that canceling review persists no operation and confirmation persists one distinct operation per item.

- [x] **Step 5: Implement the paced sequential queue**

Send no more than five POST requests in a rolling minute, sequentially, at least 13 seconds apart. Persist request start/result for each operation. On 429, pause for Retry-After when present or 60 seconds otherwise. On an uncertain timeout, replay only the identical POST with the same idempotency key and frozen payload; poll by Adaflow ID when known. Use external-ID lookup only while local history confirms that the external_id identifies exactly one operation.

- [x] **Step 6: Poll accepted NFSes and show outcomes**

Persist returned Adaflow IDs, use chrome.alarms to poll GET /nfses/{id}, and transition to issued, failed, or cancelled. If status remains requested for 15 minutes, show a follow-up state and stop automatic issue retries. Display per-item results and allow correction of actionable validation errors.

- [x] **Step 7: Test queue and review behavior**

Use fake timers and mocked API responses to verify spacing, 429 pause/resume, idempotency persistence, requested polling, >15-minute handling, partial batch failure, and no duplicate successful issue. Test that review displays critical fields and requires confirmation. Run npm run test -- tests/services/emission-queue.test.ts tests/ui/issue-review-screen.test.tsx.

- [x] **Step 8: Build and commit**

Commit as feat: issue and track Adaflow NFSes in batches.

## Task 10: Add JSON backup/import and data controls

**Files:**
- Create: src/services/backup.ts
- Create: entrypoints/sidepanel/screens/DataSettingsScreen.tsx
- Create: entrypoints/sidepanel/components/ImportPreview.tsx
- Create: tests/services/backup.test.ts
- Create: tests/ui/import-preview.test.tsx

- [x] **Step 1: Define the backup envelope and schema version**

In src/services/backup.ts define BackupEnvelope with schemaVersion, exportedAt, payments, takers, templates, nfseOperations, and non-secret preferences. Define BackupPreview with counts, duplicate IDs, and validation errors. Exclude token and runtime state by type, not by filtering an arbitrary object after serialization.

- [x] **Step 2: Implement JSON export**

Read the named Dexie tables, map them to BackupEnvelope, serialize UTF-8 JSON, and download a file named pingounota-backup-YYYY-MM-DD.json. Never include the Adaflow token, browser credentials, page HTML, or cookies.

- [x] **Step 3: Validate imported files without writing**

Parse JSON and validate the entire BackupEnvelope with Zod. Return a BackupPreview with counts, duplicate IDs, schema version, and validation errors. Invalid files produce no database writes.

- [x] **Step 4: Build the import preview and confirmation UI**

Show the preview, explain merge versus replace, and require confirmation before modifying data. Keep the original database intact if the user cancels.

- [x] **Step 5: Apply confirmed imports atomically**

Merge by provider/recordKey, taker ID, template ID, and operation ID inside one Dexie transaction. On replace, preserve only records included in the selected backup; never import a token. Abort the transaction on any write error.

- [x] **Step 6: Add delete-all control and backup tests**

Add a delete-all action that explains deletion scope and requires explicit confirmation. Test token exclusion, duplicate merge, replacement confirmation, invalid-file atomicity, and preservation of emission IDs. Run npm run test -- tests/services/backup.test.ts tests/ui/import-preview.test.tsx.

- [x] **Step 7: Run full automated suite and build**

Run npm run test and npm run build. Commit as feat: add local data backup and deletion controls.

## Task 11: Prepare public repository and publish to GitHub

**Files:**
- Create: README.md
- Create: SECURITY.md
- Create: .github/workflows/ci.yml
- Create: .github/ISSUE_TEMPLATE/bug_report.yml
- Modify: LICENSE
- Modify: .gitignore

- [ ] **Step 1: Write the public README in Portuguese**

Document purpose, screenshots of synthetic data only, local-only storage, permissions and why they are needed, development installation by loading WXT's generated .output/chrome-mv3 directory as an unpacked extension (or installing the generated ZIP), Adaflow token setup, the difference between local marking and real issuance, the five-per-minute limit, known portal parsing limitations, and MIT license.

- [ ] **Step 2: Add security and repository hygiene files**

Add MIT full text with Copyright (c) 2026 raalarcon9705. Enable GitHub Private vulnerability reporting in repository settings and put https://github.com/raalarcon9705/PingouNota/security/advisories/new in SECURITY.md with the supported-version policy. Ignore .env*, local backup JSON, portal HTML dumps, browser profiles, generated .output/, node_modules/, and test coverage output. Add a bug report template that asks for sanitized steps and explicitly says not to attach tokens or customer data.

- [ ] **Step 3: Add CI and run its exact local commands**

Configure GitHub Actions on pull requests and pushes to main with separate jobs named test and build. Both jobs run npm ci; test runs npm run test and build runs npm run build. Run these same commands locally and inspect the generated ZIP for source maps, tokens, backups, or real customer data.

- [ ] **Step 4: Perform the authenticated Chrome acceptance pass**

Load the generated .output/chrome-mv3 directory in Chrome and, using the already-authenticated Asaas and Husky pages, confirm portal detection/badge, automatic first and incremental scans, full versus partial pagination status, pending/received eligibility, local mark and its disclaimer, reviewed single/batch Adaflow flow using a non-production credential/environment if available, progress/recovery states, and all pt-BR text. Use synthetic/authorized records and do not trigger a real NFSe without the user's separate release approval.

- [ ] **Step 5: Create the public GitHub repository**

Using the connected GitHub account raalarcon9705, create public repository PingouNota with description Extensão Chrome para acompanhar pagamentos e emitir NFSe pela Adaflow, MIT license, and default branch main. Enable Issues and Private vulnerability reporting. Do not enable Discussions or GitHub Pages for the MVP. Push the local main branch, verify README/license visibility, and confirm no secrets or real payment data were committed.

- [ ] **Step 6: Protect the main branch**

After the first CI run publishes the check names test and build, configure a ruleset for main that blocks force pushes and requires both checks before merging. Confirm that the ruleset is active and does not require multiple reviewers for the single-maintainer MVP.

- [ ] **Step 7: Record the published repository URL and final commit**

Update the local README with the repository URL if needed, commit as docs: prepare PingouNota for public release, push main, and report the GitHub URL and commit ID.

## Dependency and scope notes

- The supplied Adaflow OpenAPI file is /Users/reynier/Downloads/openapi.yaml. It defines asynchronous single-NFSe issuance, ID/external-ID lookup, a required idempotency key, and a five-request-per-minute issue limit; it does not define a list-all-NFSe endpoint.
- WXT's official guide documents TypeScript entrypoints, the React module, and the sidepanel output. The planned file paths use WXT's entrypoint structure.
- Portal DOM structures and exact Asaas/Husky origins are not assumed by this plan. Task 2 captures them from authenticated pages before content-script selectors or host permissions are finalized.
- Do not add Komwise, cloud sync, a PingouNota server, automatic NFSe issuance without review, or Chrome Web Store publishing to this plan.
