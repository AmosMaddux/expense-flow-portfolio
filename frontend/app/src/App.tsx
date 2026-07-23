import { useSession } from "./auth";
import { getNavigationItemsForRole, type RoleName } from "./navigation";

type AppShellProps = {
    signedInRole: RoleName;
};

/**
 * Renders the persistent ExpenseFlow application shell for the signed-in role.
 */
export function AppShell({ signedInRole }: AppShellProps): JSX.Element {
    const visibleNavigationItems = getNavigationItemsForRole(signedInRole);
    const activeNavigationPath = visibleNavigationItems[0]?.path;

    return (
        <div className="app-shell">
            <aside className="sidebar" aria-label="Primary navigation">
                <div className="sidebar__brand">ExpenseFlow</div>
                <nav className="sidebar__nav" aria-label="Workspace sections">
                    {visibleNavigationItems.map((item) => (
                        <span
                            aria-current={
                                item.path === activeNavigationPath ? "page" : undefined
                            }
                            aria-disabled="true"
                            className="sidebar__link"
                            key={item.path}
                        >
                            {item.label}
                        </span>
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
                    <section className="screen-placeholder" aria-label="Screen content">
                        <p className="screen-placeholder__label">Screen Region</p>
                        <h2>Navigation-ready app shell</h2>
                        <p>
                            Operator and portal screens will render inside this shared frame.
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

    // return (<>
    //     <h1>USING BYPASS DO NOT COMMIT IN THIS STATE</h1>
    //     <AppShell signedInRole="Employee" />
    // </>);

    // return (<>
    //     <h1>USING BYPASS DO NOT COMMIT IN THIS STATE</h1>
    //     <AppShell signedInRole="Department Manager" />
    // </>);

    // return (<>
    //     <h1>USING BYPASS DO NOT COMMIT IN THIS STATE</h1>
    //     <AppShell signedInRole="Finance Admin" />
    // </>);

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
