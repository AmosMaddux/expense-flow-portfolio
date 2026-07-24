import {
    Outlet,
    RouterProvider,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { AppShell, RoutedWorkspaceOutlet } from "./App";
import { useSession, type SessionUser } from "./auth";
import { CaseQueueScreen } from "./caseQueue/CaseQueueScreen";
import { LogMileageScreen } from "./mileage/LogMileageScreen";
import {
    getNavigationItemsForRoles,
    navigationItems,
    type NavigationItem,
} from "./navigation";

const loginSearchSchema = z.object({
    redirect: z.string().optional(),
});

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

    return <AppStatus message="Login route" />;
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
