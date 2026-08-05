import { z } from "zod";

export const GlMappingPathParamsSchema = z.object({
    id: z.uuid(),
});

export const UpdateGlMappingInboundRequestSchema = z
    .object({
        glCodeId: z.uuid(),
    })
    .strict();

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

export type UpdateGlMappingRequest = z.infer<
    typeof UpdateGlMappingInboundRequestSchema
>;
export type GlCodeResponse = z.infer<typeof GlCodeOutboundResponseSchema>;
export type GlMappingResponse = z.infer<typeof GlMappingOutboundResponseSchema>;
export type GlMappingReferenceResponse = z.infer<
    typeof GlMappingReferenceOutboundResponseSchema
>;
