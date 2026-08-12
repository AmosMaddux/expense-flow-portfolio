import { z } from "zod";

export const roleSchema = z.enum([
    "Finance Admin",
    "Department Manager",
    "Employee",
    "Admin",
]);

export const jwtRolesClaimSchema = z.union([
    z.string().min(1),
    z.array(roleSchema).min(1),
]);

export type RoleName = z.infer<typeof roleSchema>;

const serializedRolesSchema = z.string().transform((value, context) => {
    try {
        const decodedValue: unknown = JSON.parse(value);
        const decodedRoles = z.array(roleSchema).min(1).safeParse(decodedValue);
        if (decodedRoles.success) {
            return decodedRoles.data;
        }

        const decodedRole = roleSchema.safeParse(decodedValue);
        if (decodedRole.success) {
            return [decodedRole.data];
        }
    } catch {
        // Continue with API Gateway's non-JSON string representations.
    }

    const singleRole = roleSchema.safeParse(value);
    if (singleRole.success) {
        return [singleRole.data];
    }

    const bracketedRoles = /^\[(.*)\]$/.exec(value.trim());
    if (bracketedRoles !== null) {
        const roles = z
            .array(roleSchema)
            .min(1)
            .safeParse(
                (bracketedRoles[1] ?? "")
                    .split(",")
                    .map((role) => role.trim())
                    .filter((role) => role.length > 0),
            );
        if (roles.success) {
            return roles.data;
        }
    }

    context.addIssue({
        code: "custom",
        message: "The verified roles claim is invalid.",
    });
    return z.NEVER;
});

/**
 * Parses the role formats emitted by API Gateway JWT authorizer mappings.
 */
export function parseJwtRolesClaim(roles: z.infer<typeof jwtRolesClaimSchema>) {
    return Array.isArray(roles) ? roles : serializedRolesSchema.parse(roles);
}
