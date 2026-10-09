import { z } from 'zod';

/** The shapes the model must answer in. Each is both the JSON Schema sent to the provider and the check on what comes back. */

export const SummarySchema = z.object({
  summary: z.string().min(1).max(2000),
  keyPoints: z.array(z.string().max(300)).max(10),
});

export const ExtractionSchema = z.object({
  fields: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        value: z.string().min(1).max(1000),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(40),
  productMatches: z
    .array(
      z.object({ productId: z.string().min(1).max(100), confidence: z.number().min(0).max(1) }),
    )
    .max(10),
});

export const ClassificationSchema = z.object({
  intent: z.enum(['ENQUIRY', 'QUOTE_REQUEST', 'ORDER', 'SUPPORT', 'COMPLAINT', 'OTHER']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  confidence: z.number().min(0).max(1),
});

export const DraftSchema = z.object({
  text: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
});

export const NextActionSchema = z.object({
  action: z.string().min(1).max(300),
  /** YYYY-MM-DD, or null when no date is called for. */
  followUpDate: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type Summary = z.infer<typeof SummarySchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Classification = z.infer<typeof ClassificationSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type NextAction = z.infer<typeof NextActionSchema>;

export const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> => {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json['$schema']; // providers want the bare schema
  return json;
};
