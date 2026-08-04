import { NotFoundError } from "../errors/problem-json.js";
import {
    PolicyReferenceOutboundResponseSchema,
    type PolicyReferenceResponse,
    type ReadPolicyReferenceRequest,
} from "../expenseReports/dto/expenseReportDto.js";

import {
    findTenantExpensePolicy,
    type TenantExpensePolicyRecord,
} from "./policyReferenceRepository.js";

export type PolicyReferenceRepository = {
    findTenantExpensePolicy: (
        tenantId: string,
    ) => Promise<TenantExpensePolicyRecord | null>;
};

const defaultPolicyReferenceRepository: PolicyReferenceRepository = {
    findTenantExpensePolicy,
};

/**
 * Reads the authenticated tenant's read-only expense policy reference text.
 */
export async function readPolicyReference(
    request: ReadPolicyReferenceRequest,
    repository: PolicyReferenceRepository = defaultPolicyReferenceRepository,
): Promise<PolicyReferenceResponse> {
    const policy = await repository.findTenantExpensePolicy(request.tenantId);

    if (policy === null) {
        throw new NotFoundError("Expense policy not found.");
    }

    return PolicyReferenceOutboundResponseSchema.parse({
        policyText: policy.policyText,
        updatedAt: policy.updatedAt.toISOString(),
    });
}
