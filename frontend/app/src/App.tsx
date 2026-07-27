import { Outlet } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import {
    AuthRequestError,
    useSession,
    type LoginRequest,
    type Role,
} from "./auth";
import {
    MfaChallengeScreen,
    PasswordResetConfirmationScreen,
    PasswordResetRequestScreen,
    SignInScreen,
} from "./auth/AuthScreens";
import { getNavigationItemsForRoles } from "./navigation";

type UnauthenticatedView = "sign-in" | "mfa" | "reset" | "reset-confirmation";
type PendingCredentials = Omit<LoginRequest, "totpCode">;

export type AppProps = {
    tenantId?: string;
};

type RoleLanding = {
    label: string;
    path: string;
};

const roleLandings: Record<Role, RoleLanding> = {
    "Finance Admin": {
        label: "Finance Dashboard",
        path: "/finance-dashboard",
    },
    "Department Manager": {
        label: "Expense Reports",
        path: "/expense-reports",
    },
    Employee: { label: "Employee Portal", path: "/my-submissions" },
    Admin: { label: "Administration", path: "/roles-permissions" },
};

/**
 * Selects the first workspace a role may use after authentication.
 */
export function getRoleLandingScreen(role: Role): string {
    return roleLandings[role].label;
}

/**
 * Renders authentication screens or the role-appropriate authenticated workspace.
 */
export default function App({
    tenantId = import.meta.env.VITE_TENANT_ID ?? "",
}: AppProps): JSX.Element {
    const session = useSession();
    const [view, setView] = useState<UnauthenticatedView>("sign-in");
    const [pendingCredentials, setPendingCredentials] =
        useState<PendingCredentials | null>(null);
    const [shouldNavigateToLanding, setShouldNavigateToLanding] =
        useState(false);

    useEffect(() => {
        if (
            !shouldNavigateToLanding ||
            !session.isAuthenticated ||
            session.user === null
        ) {
            return;
        }

        const landingPath = roleLandings[session.user.role].path;
        window.history.replaceState(window.history.state, "", landingPath);
        setShouldNavigateToLanding(false);
    }, [session.isAuthenticated, session.user, shouldNavigateToLanding]);

    if (session.isRestoring) {
        return (
            <main className="auth-page auth-page--loading" aria-live="polite">
                <div className="brand-mark" aria-hidden="true">
                    EF
                </div>
                <p>Restoring your secure session...</p>
            </main>
        );
    }

    if (session.isAuthenticated && session.user !== null) {
        return (
            <AppShell
                signedInRole={session.user.role}
                signedInRoles={session.user.roles}
                onLogout={async () => {
                    await session.logout();
                    window.history.replaceState(window.history.state, "", "/");
                    setPendingCredentials(null);
                    setView("sign-in");
                }}
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
                    setShouldNavigateToLanding(true);
                }}
            />
        );
    }

    return (
        <SignInScreen
            onForgotPassword={() => setView("reset")}
            onSubmit={async ({ email, password }) => {
                if (tenantId.length === 0) {
                    throw new Error(
                        "Sign-in is not configured for an organization.",
                    );
                }

                const credentials = { tenantId, email, password };

                try {
                    await session.login(credentials);
                    setShouldNavigateToLanding(true);
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

type AppShellProps = {
    children?: ReactNode;
    currentPath?: string;
    onLogout?: () => Promise<void>;
    signedInRole: Role;
    signedInRoles?: readonly Role[];
};

/**
 * Renders the persistent ExpenseFlow application shell for the signed-in role.
 */
export function AppShell({
    children,
    currentPath,
    onLogout,
    signedInRole,
    signedInRoles = [signedInRole],
}: AppShellProps): JSX.Element {
    const [browserPath, setBrowserPath] = useState(
        () => window.location.pathname,
    );
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const visibleNavigationItems = getNavigationItemsForRoles(signedInRoles);
    const landing = roleLandings[signedInRole];
    const currentBrowserPath = currentPath ?? browserPath;
    const activeNavigationPath =
        currentBrowserPath === "/" ? landing.path : currentBrowserPath;

    useEffect(() => {
        if (currentPath !== undefined) {
            return undefined;
        }

        const handleLocationChange = (): void => {
            setBrowserPath(window.location.pathname);
        };

        window.addEventListener("popstate", handleLocationChange);

        return () =>
            window.removeEventListener("popstate", handleLocationChange);
    }, [currentPath]);

    function handleSidebarNavigation(
        event: MouseEvent<HTMLAnchorElement>,
        path: string,
    ): void {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
        ) {
            return;
        }

        event.preventDefault();
        window.history.pushState(null, "", path);
        setBrowserPath(path);
        // Notify router/history listeners because pushState does not emit popstate.
        window.dispatchEvent(new PopStateEvent("popstate"));
    }

    return (
        <div className="app-shell">
            <aside className="sidebar" aria-label="Primary navigation">
                <div className="sidebar__brand">
                    <span className="sidebar__brand-mark" aria-hidden="true">
                        EF
                    </span>
                    ExpenseFlow
                </div>
                <nav className="sidebar__nav" aria-label="Workspace sections">
                    {visibleNavigationItems.map((item) => (
                        <a
                            aria-current={
                                item.path === activeNavigationPath
                                    ? "page"
                                    : undefined
                            }
                            className="sidebar__link"
                            href={item.path}
                            key={item.path}
                            onClick={(event) =>
                                handleSidebarNavigation(event, item.path)
                            }
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>
            </aside>
            <div className="workspace">
                <header className="topbar">
                    <div>
                        <p className="topbar__eyebrow">{signedInRole}</p>
                        <h1>{landing.label}</h1>
                    </div>
                    {onLogout === undefined ? (
                        <div className="topbar__tenant">{signedInRole}</div>
                    ) : (
                        <button
                            className="button button--secondary button--compact"
                            disabled={isLoggingOut}
                            onClick={() => {
                                setIsLoggingOut(true);
                                void onLogout().finally(() =>
                                    setIsLoggingOut(false),
                                );
                            }}
                            type="button"
                        >
                            {isLoggingOut ? "Signing out..." : "Sign out"}
                        </button>
                    )}
                </header>
                <main className="workspace__content">
                    {children ?? (
                        <section
                            className="screen-placeholder"
                            aria-label={`${landing.label} content`}
                        >
                            <p className="screen-placeholder__label">
                                Workspace
                            </p>
                            <h2>{landing.label}</h2>
                            <p>
                                You are signed in with the permissions assigned
                                to the {signedInRole} role.
                            </p>
                        </section>
                    )}
                </main>
            </div>
        </div>
    );
}

/**
 * Renders nested TanStack route content inside the app shell.
 */
export function RoutedWorkspaceOutlet(): JSX.Element {
    return <Outlet />;
}
