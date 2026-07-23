import { useSession } from "./auth";
import { getNavigationItemsForRole, type RoleName } from "./navigation";

type AppShellProps = {
    signedInRole: RoleName;
    currentPath?: string;
};

/**
 * Renders the persistent ExpenseFlow application shell for the signed-in role.
 */
export function AppShell({ signedInRole, currentPath }: AppShellProps): JSX.Element {
    const visibleNavigationItems = getNavigationItemsForRole(signedInRole);
    const activeNavigationPath = currentPath ?? window.location.pathname;

    return (
        <div className="app-shell">
            <aside className="sidebar" aria-label="Primary navigation">
                <div className="sidebar__brand">ExpenseFlow</div>
                <nav className="sidebar__nav" aria-label="Workspace sections">
                    {visibleNavigationItems.map((item) => (
                        <a
                            aria-current={
                                item.path === activeNavigationPath ? "page" : undefined
                            }
                            className="sidebar__link"
                            href={item.path}
                            key={item.path}
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>
            </aside>
            <div className="workspace">
                <header className="topbar">
                    <div>
                        <p className="topbar__eyebrow">Read-models/BFF</p>
                        <h1>ExpenseFlow Workspace</h1>
                    </div>
                    <div className="topbar__tenant">{signedInRole}</div>
                </header>
                <main className="workspace__content">
                    <section
                        className="screen-placeholder"
                        aria-label="Screen content"
                    >
                        <p className="screen-placeholder__label">
                            Case management workspace
                        </p>
                        <h2>Expense Report queue screen pending</h2>
                        <p>
                            This app shell is reserved for product surfaces such
                            as the Case Queue, Case Detail, Employee Portal, and
                            Administration workflows.
                        </p>
                    </section>
                </main>
            </div>
        </div>
    );
}

/**
 * Renders the app shell from the authenticated session context.
 */
export default function App(): JSX.Element {
    const { isRestoring, user } = useSession();

    if (isRestoring) {
        return <AppStatus message="Restoring session" />;
    }

    if (user === null) {
        return <AppStatus message="Sign in to continue" />;
    }

    return <AppShell signedInRole={user.role} />;
}

function AppStatus({ message }: { message: string }): JSX.Element {
    return (
        <div className="app-shell">
            <aside className="sidebar" aria-label="Primary navigation">
                <div className="sidebar__brand">ExpenseFlow</div>
            </aside>
            <div className="workspace">
                <header className="topbar">
                    <div>
                        <p className="topbar__eyebrow">Read-models/BFF</p>
                        <h1>ExpenseFlow Workspace</h1>
                    </div>
                </header>
                <main className="workspace__content">
                    <section className="screen-placeholder" aria-label="Screen content">
                        <p className="screen-placeholder__label">{message}</p>
                    </section>
                </main>
            </div>
        </div>
    );
}
