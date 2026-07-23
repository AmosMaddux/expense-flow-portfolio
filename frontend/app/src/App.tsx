import { useState } from "react";

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

type UnauthenticatedView = "sign-in" | "mfa" | "reset" | "reset-confirmation";
type PendingCredentials = Omit<LoginRequest, "totpCode">;

export type AppProps = {
    tenantId?: string;
};

const navigationItems = ["Case Queue", "Employee Portal", "Administration"];

/**
 * Selects the first workspace a role may use after authentication.
 */
export function getRoleLandingScreen(role: Role): string {
    if (role === "Employee") {
        return "Employee Portal";
    }

    if (role === "Admin") {
        return "Administration";
    }

    return "Case Queue";
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

    if (session.isRestoring) {
        return (
            <main className="auth-page auth-page--loading" aria-live="polite">
                <div className="brand-mark" aria-hidden="true">
                    EF
                </div>
                <p>Restoring your secure session…</p>
            </main>
        );
    }

    if (session.isAuthenticated && session.user !== null) {
        return (
            <AuthenticatedWorkspace
                role={session.user.role}
                onLogout={async () => {
                    await session.logout();
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
                } catch (error) {
                    if (
                        error instanceof AuthRequestError &&
                        error.status === 401
                    ) {
                        // Use one response for invalid credentials and missing MFA
                        // so the first step cannot disclose whether an account exists.
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

type AuthenticatedWorkspaceProps = {
    role: Role;
    onLogout: () => Promise<void>;
};

/**
 * Renders the authenticated shell at the current role's landing screen.
 */
function AuthenticatedWorkspace({
    role,
    onLogout,
}: AuthenticatedWorkspaceProps): JSX.Element {
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const landingScreen = getRoleLandingScreen(role);

    const visibleItems = navigationItems.filter((item) => {
        if (role === "Employee") {
            return item === "Employee Portal";
        }

        if (role === "Admin") {
            return item === "Administration";
        }

        return item === "Case Queue";
    });

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
                    {visibleItems.map((item) => (
                        <span
                            aria-current={
                                item === landingScreen ? "page" : undefined
                            }
                            className="sidebar__link"
                            key={item}
                        >
                            {item}
                        </span>
                    ))}
                </nav>
            </aside>
            <div className="workspace">
                <header className="topbar">
                    <div>
                        <p className="topbar__eyebrow">{role}</p>
                        <h1>{landingScreen}</h1>
                    </div>
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
                        {isLoggingOut ? "Signing out…" : "Sign out"}
                    </button>
                </header>
                <main className="workspace__content">
                    <section
                        className="screen-placeholder"
                        aria-label={`${landingScreen} content`}
                    >
                        <p className="screen-placeholder__label">Workspace</p>
                        <h2>{landingScreen}</h2>
                        <p>
                            You are signed in with the permissions assigned to
                            the {role} role.
                        </p>
                    </section>
                </main>
            </div>
        </div>
    );
}
