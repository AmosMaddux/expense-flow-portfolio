import { z } from "zod";

const CategorySchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500).nullable();
const AccountCodeSchema = z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^\d+$/, "GL account code must contain only digits.");

export const GlCodeOutboundResponseSchema = z.object({
    id: z.uuid(),
    accountCode: z.string().min(1),
    accountName: z.string().min(1),
    description: z.string().nullable(),
});

export const GlMappingOutboundResponseSchema = z.object({
    id: z.uuid(),
    category: z.string().min(1),
    glCodeId: z.uuid(),
    accountCode: z.string().min(1),
    accountName: z.string().min(1),
    description: z.string().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
});

export const GlMappingReferenceOutboundResponseSchema = z.object({
    mappings: z.array(GlMappingOutboundResponseSchema),
    glCodes: z.array(GlCodeOutboundResponseSchema),
});

const BatchCreateGlMappingSchema = z
    .object({
        clientId: z.string().min(1),
        category: CategorySchema,
        accountCode: AccountCodeSchema,
        description: DescriptionSchema.default(null),
    })
    .strict();

const BatchUpdateGlMappingSchema = z
    .object({
        id: z.uuid(),
        category: CategorySchema,
        accountCode: AccountCodeSchema,
        description: DescriptionSchema.default(null),
    })
    .strict();

export const SaveGlMappingsInboundRequestSchema = z
    .object({
        creates: z.array(BatchCreateGlMappingSchema).max(200),
        updates: z.array(BatchUpdateGlMappingSchema).max(200),
        deletes: z.array(z.uuid()).max(200),
    })
    .strict();

export type SaveGlMappingsRequest = z.infer<
    typeof SaveGlMappingsInboundRequestSchema
>;
export type GlCodeResponse = z.infer<typeof GlCodeOutboundResponseSchema>;
export type GlMappingResponse = z.infer<typeof GlMappingOutboundResponseSchema>;
export type GlMappingReferenceResponse = z.infer<
    typeof GlMappingReferenceOutboundResponseSchema
>;
