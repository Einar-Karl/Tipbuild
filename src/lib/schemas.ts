import { z } from 'zod';

export const operatorInput = z.object({
  name: z.string().trim().min(2).max(80),
  feeBpsOverride: z.number().int().min(0).max(3000).nullable().optional(),
  reviewUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'must be an https URL')
    .nullable()
    .optional(),
});
