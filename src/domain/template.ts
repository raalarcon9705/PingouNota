import { z } from 'zod';

export interface ServiceTemplate {
  id: string;
  name: string;
  cnae: string;
  description: string;
  withholdTaxes: boolean;
  forwardingEmail: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const serviceTemplateSchema = z.object({
  id: z.string().min(1, 'ID é obrigatório'),
  name: z.string().min(1, 'Nome da template é obrigatório'),
  cnae: z.string().min(1, 'CNAE é obrigatório'),
  description: z.string().min(1, 'Descrição é obrigatória'),
  withholdTaxes: z.boolean().default(false),
  forwardingEmail: z
    .string()
    .nullable()
    .refine((val) => val === null || val === '' || z.string().email().safeParse(val).success, {
      message: 'E-mail de encaminhamento inválido',
    })
    .default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
