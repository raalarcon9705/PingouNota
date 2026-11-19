import { z } from 'zod';

export interface TakerProfile {
  id: string;
  name: string;
  document: string | null;
  externalId: string | null;
  email: string | null;
  address: {
    line1: string;
    number: string | null;
    neighborhood: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface AdaflowServiceTaker {
  document?: string;
  external_id?: string;
  name?: string;
  email?: string;
  address?: {
    line1: string;
    number?: string;
    neighborhood?: string;
    city: string;
    state: string;
    postal_code: string;
    country?: string;
  };
}

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== Number(digits[10])) return false;

  return true;
}

export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * weights1[i]!;
  }
  let rem = sum % 11;
  const dig1 = rem < 2 ? 0 : 11 - rem;
  if (dig1 !== Number(digits[12])) return false;

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(digits[i]) * weights2[i]!;
  }
  rem = sum % 11;
  const dig2 = rem < 2 ? 0 : 11 - rem;
  if (dig2 !== Number(digits[13])) return false;

  return true;
}

export function isValidBrazilianDocument(value: string): boolean {
  return isValidCpf(value) || isValidCnpj(value);
}

export const takerAddressSchema = z.object({
  line1: z.string().min(1, 'Logradouro é obrigatório'),
  number: z.string().nullable().default(null),
  neighborhood: z.string().nullable().default(null),
  city: z.string().min(1, 'Cidade é obrigatória'),
  state: z.string().min(2, 'Estado deve ter 2 caracteres'),
  postalCode: z.string().min(1, 'CEP é obrigatório'),
  country: z.string().default('BR'),
});

export const takerProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Nome do tomador é obrigatório'),
  document: z
    .string()
    .nullable()
    .refine((val) => val === null || val === '' || isValidBrazilianDocument(val), {
      message: 'Documento deve ser um CPF ou CNPJ válido',
    })
    .default(null),
  externalId: z.string().nullable().default(null),
  email: z
    .string()
    .nullable()
    .refine((val) => val === null || val === '' || z.string().email().safeParse(val).success, {
      message: 'E-mail inválido',
    })
    .default(null),
  address: takerAddressSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const adaflowAddressSchema = z.object({
  line1: z.string().min(1, 'Logradouro é obrigatório'),
  number: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().min(1, 'Cidade é obrigatória'),
  state: z.string().min(2, 'Estado é obrigatório'),
  postal_code: z.string().min(1, 'CEP é obrigatório'),
  country: z.string().optional(),
});

export const adaflowServiceTakerSchema = z.object({
  document: z
    .string()
    .optional()
    .refine((val) => val === undefined || val === '' || isValidBrazilianDocument(val), {
      message: 'Documento deve ser um CPF ou CNPJ válido',
    }),
  external_id: z.string().optional(),
  name: z.string().optional(),
  email: z
    .string()
    .optional()
    .refine((val) => val === undefined || val === '' || z.string().email().safeParse(val).success, {
      message: 'E-mail inválido',
    }),
  address: adaflowAddressSchema.optional(),
});

export const brazilianServiceTakerSchema = z.object({
  name: z.string().min(1, 'Nome do tomador é obrigatório para tomador brasileiro'),
  document: z.string().refine((val) => isValidBrazilianDocument(val), {
    message: 'CPF ou CNPJ válido é obrigatório para tomador brasileiro',
  }),
  external_id: z.string().optional(),
  email: z
    .string()
    .optional()
    .refine((val) => val === undefined || val === '' || z.string().email().safeParse(val).success, {
      message: 'E-mail inválido',
    }),
  address: adaflowAddressSchema,
});
