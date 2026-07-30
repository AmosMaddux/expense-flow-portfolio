import { Outlet } from "@tanstack/react-router";
import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from "react";

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

const mobileNavigationMediaQuery = "(max-width: 760px)";

const roleLandings: Record<Role, RoleLanding> = {
    "Finance Admin": {
        label: "Finance Dashboard",
        path: "/finance-dashboard",
    },
    "Department Manager": {
        label: "Finance Dashboard",
        path: "/finance-dashboard",
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
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isMobileNavigation, setIsMobileNavigation] = useState(() =>
        getMediaQueryMatches(mobileNavigationMediaQuery),
    );
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const menuButtonRef = useRef<HTMLButtonElement | null>(null);
    const sidebarRef = useRef<HTMLElement | null>(null);
    const sidebarCloseButtonRef = useRef<HTMLButtonElement | null>(null);
    const visibleNavigationItems = getNavigationItemsForRoles(signedInRoles);
    const landing = roleLandings[signedInRole];
    const currentBrowserPath = currentPath ?? browserPath;
    const activeNavigationPath =
        currentBrowserPath === "/" ? landing.path : currentBrowserPath;
    const isMobileNavigationOpen = isSidebarOpen && isMobileNavigation;

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

    useEffect(() => {
        const mediaQueryList = window.matchMedia?.(mobileNavigationMediaQuery);
        if (mediaQueryList === undefined) {
            return undefined;
        }

        const handleMediaQueryChange = (event: MediaQueryListEvent): void => {
            setIsMobileNavigation(event.matches);
        };

        setIsMobileNavigation(mediaQueryList.matches);
        mediaQueryList.addEventListener("change", handleMediaQueryChange);

        return () =>
            mediaQueryList.removeEventListener(
                "change",
                handleMediaQueryChange,
            );
    }, []);

    useEffect(() => {
        if (!isMobileNavigation && isSidebarOpen) {
            setIsSidebarOpen(false);
        }
    }, [isMobileNavigation, isSidebarOpen]);

    useEffect(() => {
        if (!isMobileNavigationOpen) {
            return undefined;
        }

        const previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = previousBodyOverflow;
        };
    }, [isMobileNavigationOpen]);

    useEffect(() => {
        if (!isMobileNavigationOpen) {
            return undefined;
        }

        sidebarCloseButtonRef.current?.focus();

        const handleDocumentKeyDown = (
            event: globalThis.KeyboardEvent,
        ): void => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeSidebar();
            }
        };

        document.addEventListener("keydown", handleDocumentKeyDown);

        return () =>
            document.removeEventListener("keydown", handleDocumentKeyDown);
    }, [isMobileNavigationOpen]);

    function closeSidebar(): void {
        setIsSidebarOpen(false);
        if (isMobileNavigationOpen) {
            window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        }
    }

    function handleSidebarKeyDown(event: KeyboardEvent<HTMLElement>): void {
        if (event.key !== "Tab" || sidebarRef.current === null) {
            return;
        }

        const focusableElements = Array.from(
            sidebarRef.current.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
        ).filter((element) => !element.hasAttribute("disabled"));
        const firstElement = focusableElements[0];
        const lastElement = focusableElements.at(-1);
        if (firstElement === undefined || lastElement === undefined) {
            return;
        }

        if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
            return;
        }

        if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }
    }

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
        closeSidebar();
        // Notify router/history listeners because pushState does not emit popstate.
        window.dispatchEvent(new PopStateEvent("popstate"));
    }

    return (
        <div className="app-shell">
            {isMobileNavigationOpen ? (
                <button
                    aria-label="Close navigation overlay"
                    className="sidebar-backdrop"
                    onClick={closeSidebar}
                    type="button"
                />
            ) : null}
            <aside
                aria-label="Primary navigation"
                aria-modal={isMobileNavigationOpen ? true : undefined}
                className={`sidebar${isSidebarOpen ? " sidebar--open" : ""}`}
                id="primary-navigation"
                onKeyDown={handleSidebarKeyDown}
                ref={sidebarRef}
                role={isMobileNavigationOpen ? "dialog" : undefined}
            >
                <div className="sidebar__header">
                    <div className="sidebar__brand">
                        <span
                            className="sidebar__brand-mark"
                            aria-hidden="true"
                        >
                            EF
                        </span>
                        ExpenseFlow
                    </div>
                    {isMobileNavigationOpen ? (
                        <button
                            aria-label="Close navigation"
                            className="sidebar__close"
                            onClick={closeSidebar}
                            ref={sidebarCloseButtonRef}
                            type="button"
                        >
                            <span aria-hidden="true">X</span>
                        </button>
                    ) : null}
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
            <div
                aria-hidden={isMobileNavigationOpen ? true : undefined}
                className="workspace"
            >
                <header className="topbar">
                    <div className="topbar__heading">
                        <button
                            aria-controls="primary-navigation"
                            aria-expanded={isMobileNavigationOpen}
                            aria-label={
                                isMobileNavigationOpen
                                    ? "Close navigation"
                                    : "Open navigation"
                            }
                            className="topbar__menu"
                            onClick={() =>
                                isMobileNavigationOpen
                                    ? closeSidebar()
                                    : setIsSidebarOpen(true)
                            }
                            ref={menuButtonRef}
                            type="button"
                        >
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                        </button>
                        <div>
                            <p className="topbar__eyebrow">{signedInRole}</p>
                            <h1>{landing.label}</h1>
                        </div>
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

function getMediaQueryMatches(query: string): boolean {
    return window.matchMedia?.(query).matches ?? false;
}
