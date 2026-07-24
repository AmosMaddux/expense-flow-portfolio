import {
    Outlet,
    RouterProvider,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { AppShell, RoutedWorkspaceOutlet } from "./App";
import {
    AuthRequestError,
    useSession,
    type LoginRequest,
    type SessionUser,
} from "./auth";
import {
    MfaChallengeScreen,
    PasswordResetConfirmationScreen,
    PasswordResetRequestScreen,
    SignInScreen,
} from "./auth/AuthScreens";
import { CaseQueueScreen } from "./caseQueue/CaseQueueScreen";
import { LogMileageScreen } from "./mileage/LogMileageScreen";
import { AllTransactionsScreen } from "./transactions/AllTransactionsScreen";
import {
    getNavigationItemsForRoles,
    navigationItems,
    type NavigationItem,
} from "./navigation";

const loginSearchSchema = z.object({
    redirect: z.string().optional(),
});

type UnauthenticatedView = "sign-in" | "mfa" | "reset" | "reset-confirmation";
type PendingCredentials = Omit<LoginRequest, "totpCode">;

const rootRoute = createRootRoute({
    component: Outlet,
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: IndexRedirect,
});

const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    validateSearch: (search) => loginSearchSchema.parse(search),
    component: LoginRoute,
});

const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "authenticated",
    component: AuthenticatedLayout,
});

const protectedRoutes = navigationItems.map((item) =>
    createRoute({
        getParentRoute: () => authenticatedRoute,
        path: item.path,
        component: () =>
            item.path === "/approval-queue" ? (
                <CaseQueueScreen />
            ) : item.path === "/log-mileage" ? (
                <LogMileageScreen />
            ) : item.path === "/transactions" ? (
                <AllTransactionsScreen />
            ) : (
                <WorkspaceScreen item={item} />
            ),
    }),
);

const routeTree = rootRoute.addChildren([
    indexRoute,
    loginRoute,
    authenticatedRoute.addChildren(protectedRoutes),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

/**
 * Provides the authenticated ExpenseFlow route tree.
 */
export function ExpenseFlowRouter(): JSX.Element {
    return <RouterProvider router={router} />;
}

function IndexRedirect(): JSX.Element {
    const session = useSession();

    if (session.isRestoring) {
        return <AppStatus message="Restoring session" />;
    }

    if (session.user === null) {
        return <RouteRedirect to="/login" />;
    }

    return <RouteRedirect to={getDashboardPathForUser(session.user)} />;
}

function LoginRoute(): JSX.Element {
    const session = useSession();
    const search = loginRoute.useSearch();
    const [view, setView] = useState<UnauthenticatedView>("sign-in");
    const [pendingCredentials, setPendingCredentials] =
        useState<PendingCredentials | null>(null);

    if (session.isRestoring) {
        return <AppStatus message="Restoring session" />;
    }

    if (session.user !== null) {
        return (
            <RouteRedirect
                to={getPostLoginPath(session.user, search.redirect)}
            />
        );
    }

    if (view === "reset") {
        return (
            <PasswordResetRequestScreen
                onBack={() => setView("sign-in")}
                onRequested={() => setView("reset-confirmation")}
            />
        );
    }

    if (view === "reset-confirmation") {
        return (
            <PasswordResetConfirmationScreen
                onBack={() => setView("sign-in")}
            />
        );
    }

    if (view === "mfa" && pendingCredentials !== null) {
        return (
            <MfaChallengeScreen
                email={pendingCredentials.email}
                onBack={() => {
                    setPendingCredentials(null);
                    setView("sign-in");
                }}
                onVerify={async (totpCode) => {
                    await session.login({ ...pendingCredentials, totpCode });
                }}
            />
        );
    }

    return (
        <SignInScreen
            onForgotPassword={() => setView("reset")}
            onSubmit={async ({ email, password }) => {
                const tenantId = import.meta.env.VITE_TENANT_ID ?? "";
                if (tenantId.length === 0) {
                    throw new Error(
                        "Sign-in is not configured for an organization.",
                    );
                }

                const credentials = { tenantId, email, password };

                try {
                    await session.login(credentials);
                } catch (error) {
                    if (
                        error instanceof AuthRequestError &&
                        error.code === "MFA_REQUIRED"
                    ) {
                        setPendingCredentials(credentials);
                        setView("mfa");
                        return;
                    }

                    throw error;
                }
            }}
        />
    );
}

function AuthenticatedLayout(): JSX.Element {
    const session = useSession();
    const location = useLocation();

    if (session.isRestoring) {
        return <AppStatus message="Restoring session" />;
    }

    if (session.user === null) {
        return <RouteRedirect redirect={location.pathname} to="/login" />;
    }

    if (!isPathAllowedForUser(location.pathname, session.user)) {
        return <RouteRedirect to={getDashboardPathForUser(session.user)} />;
    }

    return (
        <AppShell
            currentPath={location.pathname}
            signedInRole={session.user.role}
            signedInRoles={session.user.roles}
            onLogout={async () => {
                await session.logout();
            }}
        >
            <RoutedWorkspaceOutlet />
        </AppShell>
    );
}

function RouteRedirect({
    redirect,
    to,
}: {
    redirect?: string;
    to: string;
}): JSX.Element | null {
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (location.pathname === to) {
            return;
        }

        const navigationOptions =
            redirect === undefined
                ? { replace: true, to }
                : { replace: true, search: { redirect }, to };

        void Promise.resolve(navigate(navigationOptions as never)).catch(
            () => undefined,
        );
    }, [location.pathname, navigate, redirect, to]);

    return null;
}

function WorkspaceScreen({ item }: { item: NavigationItem }): JSX.Element {
    return (
        <section className="screen-placeholder" aria-label="Screen content">
            <p className="screen-placeholder__label">Dashboard</p>
            <h2>{item.label}</h2>
            <p>
                This protected workspace route is available to signed-in users
                with the right ExpenseFlow role.
            </p>
        </section>
    );
}

function AppStatus({ message }: { message: string }): JSX.Element {
    return (
        <main className="status-page">
            <section className="screen-placeholder" aria-label="Screen content">
                <p className="screen-placeholder__label">{message}</p>
            </section>
        </main>
    );
}

function getDashboardPathForUser(user: SessionUser): string {
    return getNavigationItemsForRoles(user.roles)[0]?.path ?? "/login";
}

function getPostLoginPath(user: SessionUser, redirectPath?: string): string {
    if (
        redirectPath !== undefined &&
        redirectPath.startsWith("/") &&
        isPathAllowedForUser(redirectPath, user)
    ) {
        return redirectPath;
    }

    return getDashboardPathForUser(user);
}

function isPathAllowedForUser(pathname: string, user: SessionUser): boolean {
    return getNavigationItemsForRoles(user.roles).some(
        (item) => item.path === pathname,
    );
}
