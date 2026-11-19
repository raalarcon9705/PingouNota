import type { Payment } from '../domain/payment';
import type { AdaflowServiceTaker } from '../domain/taker';
import type { NfseIssuePayload } from '../domain/nfse-operation';
import { type ServiceTemplate, serviceTemplateSchema } from '../domain/template';
import { db, type PingouNotaDB } from '../storage/database';

export const PT_BR_MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export interface RenderTemplateOptions {
  /**
   * Fallback date to use when paymentDate is null or invalid.
   * If explicitly undefined, defaults to current date.
   * If set to null, placeholders will be cleared (empty strings).
   */
  fallbackDate?: Date | string | null;
  /**
   * Format for {{mes}}: 'name' (e.g. "novembro") or 'numeric' (e.g. "11").
   * Defaults to 'name'.
   */
  monthFormat?: 'name' | 'numeric';
  /**
   * If true and paymentDate is null/invalid without a fallbackDate,
   * replace {{mes}} and {{ano}} with empty string instead of current date.
   */
  emptyIfNull?: boolean;
}

/**
 * Parses paymentDate string into year and 0-based month index.
 */
function parseDateParts(
  paymentDate: string | null | undefined,
  options?: RenderTemplateOptions,
): { year: number; monthIndex: number } | null {
  if (paymentDate) {
    const isoMatch = paymentDate.match(/^(\d{4})-(\d{2})/);
    if (isoMatch && isoMatch[1] && isoMatch[2]) {
      const year = parseInt(isoMatch[1], 10);
      const monthIndex = parseInt(isoMatch[2], 10) - 1;
      if (!isNaN(year) && monthIndex >= 0 && monthIndex <= 11) {
        return { year, monthIndex };
      }
    }

    const parsed = new Date(paymentDate);
    if (!isNaN(parsed.getTime())) {
      return {
        year: parsed.getUTCFullYear(),
        monthIndex: parsed.getUTCMonth(),
      };
    }
  }

  if (options?.emptyIfNull || options?.fallbackDate === null) {
    return null;
  }

  const fallback = options?.fallbackDate ? new Date(options.fallbackDate) : new Date();
  if (isNaN(fallback.getTime())) {
    return null;
  }

  return {
    year: fallback.getUTCFullYear(),
    monthIndex: fallback.getUTCMonth(),
  };
}

/**
 * Renders template description replacing {{mes}} and {{ano}} tokens based on paymentDate.
 * Also supports {{mes_numero}}, {{mes_num}}, {{mes_nome}}, {{mes_extenso}}.
 */
export function renderTemplateDescription(
  templateText: string,
  paymentDate: string | null,
  options?: RenderTemplateOptions,
): string {
  if (!templateText) return '';

  const dateParts = parseDateParts(paymentDate, options);

  if (!dateParts) {
    return templateText
      .replace(/{{\s*mes\s*}}/gi, '')
      .replace(/{{\s*mes_numero\s*}}/gi, '')
      .replace(/{{\s*mes_num\s*}}/gi, '')
      .replace(/{{\s*mes_nome\s*}}/gi, '')
      .replace(/{{\s*mes_extenso\s*}}/gi, '')
      .replace(/{{\s*ano\s*}}/gi, '');
  }

  const { year, monthIndex } = dateParts;
  const monthName = PT_BR_MONTH_NAMES[monthIndex] ?? '';
  const monthNumeric = String(monthIndex + 1).padStart(2, '0');

  const defaultMonthValue =
    options?.monthFormat === 'numeric' ? monthNumeric : monthName;

  return templateText
    .replace(/{{\s*mes\s*}}/gi, (match) => {
      if (options?.monthFormat === 'numeric') return monthNumeric;
      // Preserve first-letter capitalization if user wrote {{Mes}}
      if (match.startsWith('{{Mes') || match.startsWith('{{MES')) {
        return monthName.charAt(0).toUpperCase() + monthName.slice(1);
      }
      return defaultMonthValue;
    })
    .replace(/{{\s*mes_numero\s*}}/gi, monthNumeric)
    .replace(/{{\s*mes_num\s*}}/gi, monthNumeric)
    .replace(/{{\s*mes_nome\s*}}/gi, monthName)
    .replace(/{{\s*mes_extenso\s*}}/gi, monthName)
    .replace(/{{\s*ano\s*}}/gi, String(year));
}

export interface PreparedInvoiceDraft {
  templateId: string;
  cnae: string;
  description: string;
  valueCents: number | null;
  currency: string;
  isForeignCurrency: boolean;
  withholdTaxes: boolean;
  forwardingEmail: string | null;
  paymentRecordKey: string;
  paymentProvider: 'asaas' | 'husky';
  paymentDate: string | null;
}

/**
 * Prepares an invoice draft pulling amount and currency from payment,
 * preserving CNAE, withhold_taxes, and forwardingEmail from template,
 * while allowing custom description overrides.
 */
export function prepareInvoiceDraft(
  template: ServiceTemplate,
  payment: Payment,
  options?: {
    customDescription?: string;
    fallbackDate?: Date | string | null;
  },
): PreparedInvoiceDraft {
  const isForeign = payment.currency && payment.currency.toUpperCase() !== 'BRL';
  const description =
    options?.customDescription !== undefined
      ? options.customDescription
      : renderTemplateDescription(template.description, payment.paymentDate, {
          fallbackDate: options?.fallbackDate,
        });

  return {
    templateId: template.id,
    cnae: template.cnae,
    description,
    valueCents: payment.amountCents,
    currency: (payment.currency || 'BRL').toUpperCase(),
    isForeignCurrency: Boolean(isForeign),
    withholdTaxes: template.withholdTaxes,
    forwardingEmail: template.forwardingEmail,
    paymentRecordKey: payment.recordKey,
    paymentProvider: payment.provider,
    paymentDate: payment.paymentDate,
  };
}

/**
 * Builds an NfseIssuePayload from a ServiceTemplate and Payment.
 * Preserves CNAE, withhold_taxes, forwarding_email and pulls amount/currency.
 * Allows customDescription overrides.
 */
export function buildNfseIssuePayload(
  template: ServiceTemplate,
  payment: Payment,
  taker: AdaflowServiceTaker,
  options?: {
    customDescription?: string;
    externalId?: string;
    fallbackDate?: Date | string | null;
  },
): NfseIssuePayload {
  const description =
    options?.customDescription !== undefined
      ? options.customDescription
      : renderTemplateDescription(template.description, payment.paymentDate, {
          fallbackDate: options?.fallbackDate,
        });

  const isForeign =
    payment.currency &&
    payment.currency.toUpperCase() !== 'BRL' &&
    ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(payment.currency.toUpperCase());

  const externalId =
    options?.externalId || `${payment.provider}_${payment.recordKey}`;

  const payload: NfseIssuePayload = {
    cnae: template.cnae,
    description,
    withhold_taxes: template.withholdTaxes,
    forwarding_email: template.forwardingEmail || undefined,
    external_id: externalId,
    service_taker: taker,
  };

  if (isForeign && payment.currency) {
    payload.foreign_value_cents = payment.amountCents ?? undefined;
    payload.foreign_value_currency = payment.currency.toUpperCase() as any;
  } else {
    payload.value_cents = payment.amountCents ?? undefined;
  }

  return payload;
}

/**
 * List all templates stored in Dexie.
 */
export async function listTemplates(
  dbInstance: PingouNotaDB = db,
): Promise<ServiceTemplate[]> {
  const list = await dbInstance.templates.toArray();
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Retrieve a template by ID from Dexie.
 */
export async function getTemplate(
  id: string,
  dbInstance: PingouNotaDB = db,
): Promise<ServiceTemplate | undefined> {
  return dbInstance.templates.get(id);
}

/**
 * Create or update a ServiceTemplate in Dexie.
 * Validates against serviceTemplateSchema.
 */
export async function saveTemplate(
  template: ServiceTemplate,
  dbInstance: PingouNotaDB = db,
): Promise<ServiceTemplate> {
  const validated = serviceTemplateSchema.parse(template);
  const now = new Date().toISOString();
  const existing = await dbInstance.templates.get(validated.id);

  const toSave: ServiceTemplate = {
    ...validated,
    createdAt: existing?.createdAt || validated.createdAt || now,
    updatedAt: now,
  };

  await dbInstance.templates.put(toSave);
  return toSave;
}

/**
 * Delete a ServiceTemplate from Dexie by ID.
 */
export async function deleteTemplate(
  id: string,
  dbInstance: PingouNotaDB = db,
): Promise<void> {
  await dbInstance.templates.delete(id);
}
