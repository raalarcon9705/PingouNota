import { beforeEach, describe, expect, it } from 'vitest';
import type { Payment } from '../../src/domain/payment';
import type { ServiceTemplate } from '../../src/domain/template';
import type { AdaflowServiceTaker } from '../../src/domain/taker';
import { createDatabase, type PingouNotaDB } from '../../src/storage/database';
import {
  buildNfseIssuePayload,
  deleteTemplate,
  getTemplate,
  listTemplates,
  prepareInvoiceDraft,
  renderTemplateDescription,
  saveTemplate,
} from '../../src/services/templates';

describe('Templates Service', () => {
  let testDb: PingouNotaDB;

  beforeEach(async () => {
    testDb = createDatabase(`test-templates-db-${Date.now()}-${Math.random()}`);
    await testDb.templates.clear();
  });

  const sampleTemplate: ServiceTemplate = {
    id: 'tmpl_software_dev',
    name: 'Desenvolvimento de Software',
    cnae: '6201-5/01',
    description:
      'Prestação de serviços de consultoria e desenvolvimento de software referente a {{mes}} de {{ano}}.',
    withholdTaxes: true,
    forwardingEmail: 'contato@empresa.com.br',
  };

  const samplePaymentBrl: Payment = {
    provider: 'asaas',
    recordKey: 'pay_test_01',
    sourcePaymentId: 'pay_src_01',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: null,
    payerName: 'Cliente Alpha',
    amountCents: 500000,
    currency: 'BRL',
    paymentDate: '2026-11-20',
    sourceStatus: 'RECEIVED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-11-20T10:00:00Z',
    manualDeclaredAt: null,
  };

  const samplePaymentUsd: Payment = {
    provider: 'husky',
    recordKey: 'pay_test_02',
    sourcePaymentId: 'pay_src_02',
    identityConfidence: 'high',
    ambiguousIdentity: false,
    identityFingerprint: null,
    payerName: 'US Client Inc.',
    amountCents: 350000, // $ 3,500.00
    currency: 'USD',
    paymentDate: '2026-05-15',
    sourceStatus: 'COMPLETED',
    paymentState: 'recebido',
    declarationState: 'nao_declarado',
    lastObservedAt: '2026-05-15T12:00:00Z',
    manualDeclaredAt: null,
  };

  const sampleTaker: AdaflowServiceTaker = {
    name: 'Cliente Alpha',
    document: '12345678000195',
    address: {
      line1: 'Avenida Paulista',
      number: '1000',
      city: 'São Paulo',
      state: 'SP',
      postal_code: '01310-100',
      country: 'BR',
    },
  };

  describe('renderTemplateDescription', () => {
    it('renders {{mes}} in pt-BR month name and {{ano}} from ISO paymentDate', () => {
      const template = 'Serviços prestados em {{mes}} de {{ano}}.';
      const rendered = renderTemplateDescription(template, '2026-11-10');
      expect(rendered).toBe('Serviços prestados em novembro de 2026.');
    });

    it('capitalizes {{Mes}} when written with initial capital letter', () => {
      const template = 'Competência: {{Mes}}/{{ano}}';
      const rendered = renderTemplateDescription(template, '2026-03-01');
      expect(rendered).toBe('Competência: Março/2026');
    });

    it('renders {{mes_numero}} and {{mes_num}} as 2-digit numbers', () => {
      const template = 'NFSe referente ao período {{mes_numero}}/{{ano}} (código {{mes_num}})';
      const rendered = renderTemplateDescription(template, '2026-07-25');
      expect(rendered).toBe('NFSe referente ao período 07/2026 (código 07)');
    });

    it('supports monthFormat: numeric option for {{mes}}', () => {
      const template = 'Mês {{mes}} do ano {{ano}}';
      const rendered = renderTemplateDescription(template, '2026-04-12', {
        monthFormat: 'numeric',
      });
      expect(rendered).toBe('Mês 04 do ano 2026');
    });

    it('falls back to provided fallbackDate when paymentDate is null', () => {
      const template = 'Competência: {{mes}} de {{ano}}';
      const rendered = renderTemplateDescription(template, null, {
        fallbackDate: '2025-08-01',
      });
      expect(rendered).toBe('Competência: agosto de 2025');
    });

    it('falls back to current date when paymentDate is null and no fallbackDate specified', () => {
      const template = 'Ano: {{ano}}';
      const currentYear = String(new Date().getUTCFullYear());
      const rendered = renderTemplateDescription(template, null);
      expect(rendered).toBe(`Ano: ${currentYear}`);
    });

    it('clears placeholders when paymentDate is null and emptyIfNull is true', () => {
      const template = 'Competência: {{mes}}/{{ano}}';
      const rendered = renderTemplateDescription(template, null, {
        emptyIfNull: true,
      });
      expect(rendered).toBe('Competência: /');
    });
  });

  describe('prepareInvoiceDraft and buildNfseIssuePayload', () => {
    it('pulls amount and currency from domestic payment and preserves template CNAE, withhold_taxes, forwardingEmail', () => {
      const draft = prepareInvoiceDraft(sampleTemplate, samplePaymentBrl);

      expect(draft.templateId).toBe('tmpl_software_dev');
      expect(draft.cnae).toBe('6201-5/01');
      expect(draft.valueCents).toBe(500000);
      expect(draft.currency).toBe('BRL');
      expect(draft.isForeignCurrency).toBe(false);
      expect(draft.withholdTaxes).toBe(true);
      expect(draft.forwardingEmail).toBe('contato@empresa.com.br');
      expect(draft.description).toContain('novembro de 2026');
    });

    it('supports custom description overrides in prepareInvoiceDraft', () => {
      const customText = 'Descrição customizada específica para este cliente.';
      const draft = prepareInvoiceDraft(sampleTemplate, samplePaymentBrl, {
        customDescription: customText,
      });

      expect(draft.description).toBe(customText);
    });

    it('pulls foreign currency details correctly into NfseIssuePayload for USD payment', () => {
      const payload = buildNfseIssuePayload(
        sampleTemplate,
        samplePaymentUsd,
        sampleTaker,
      );

      expect(payload.cnae).toBe('6201-5/01');
      expect(payload.withhold_taxes).toBe(true);
      expect(payload.forwarding_email).toBe('contato@empresa.com.br');
      expect(payload.foreign_value_cents).toBe(350000);
      expect(payload.foreign_value_currency).toBe('USD');
      expect(payload.value_cents).toBeUndefined();
      expect(payload.description).toContain('maio de 2026');
      expect(payload.service_taker).toEqual(sampleTaker);
    });

    it('supports custom description override in buildNfseIssuePayload', () => {
      const payload = buildNfseIssuePayload(
        sampleTemplate,
        samplePaymentBrl,
        sampleTaker,
        {
          customDescription: 'Custom NFSe override description',
        },
      );

      expect(payload.description).toBe('Custom NFSe override description');
      expect(payload.value_cents).toBe(500000);
    });
  });

  describe('CRUD operations for templates in Dexie', () => {
    it('lists templates (initially empty)', async () => {
      const list = await listTemplates(testDb);
      expect(list).toEqual([]);
    });

    it('creates, retrieves, updates, and deletes a template', async () => {
      // Create
      const created = await saveTemplate(sampleTemplate, testDb);
      expect(created.id).toBe('tmpl_software_dev');
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      // Retrieve
      const fetched = await getTemplate('tmpl_software_dev', testDb);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe('Desenvolvimento de Software');
      expect(fetched?.withholdTaxes).toBe(true);

      // List has 1 item
      const list = await listTemplates(testDb);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe('tmpl_software_dev');

      // Update
      const updated = await saveTemplate(
        {
          ...fetched!,
          name: 'Desenvolvimento Web e Mobile',
          withholdTaxes: false,
        },
        testDb,
      );
      expect(updated.name).toBe('Desenvolvimento Web e Mobile');
      expect(updated.withholdTaxes).toBe(false);
      expect(updated.createdAt).toBe(created.createdAt);

      const fetchedUpdated = await getTemplate('tmpl_software_dev', testDb);
      expect(fetchedUpdated?.name).toBe('Desenvolvimento Web e Mobile');
      expect(fetchedUpdated?.withholdTaxes).toBe(false);

      // Delete
      await deleteTemplate('tmpl_software_dev', testDb);
      const afterDelete = await getTemplate('tmpl_software_dev', testDb);
      expect(afterDelete).toBeUndefined();

      const emptyList = await listTemplates(testDb);
      expect(emptyList).toEqual([]);
    });

    it('validates schema before saving and throws on invalid data', async () => {
      const invalidTemplate: any = {
        id: 'tmpl_invalid',
        name: '', // Empty name violates schema
        cnae: '6201-5/01',
        description: 'Test',
        withholdTaxes: false,
        forwardingEmail: 'not-an-email',
      };

      await expect(saveTemplate(invalidTemplate, testDb)).rejects.toThrow();
    });
  });
});
