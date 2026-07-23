import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { getNavigationItemsForRoles, type RoleName } from "./navigation";

type AppShellProps = {
    currentPath?: string;
    signedInRole: RoleName;
    signedInRoles?: readonly RoleName[];
    children?: ReactNode;
};

/**
 * Renders the persistent ExpenseFlow application shell for the signed-in role.
 */
export function AppShell({
    children = <DefaultWorkspaceScreen />,
    currentPath,
    signedInRole,
    signedInRoles = [signedInRole],
}: AppShellProps): JSX.Element {
    const visibleNavigationItems = getNavigationItemsForRoles(signedInRoles);
    const activeNavigationPath = currentPath ?? visibleNavigationItems[0]?.path;

    return (
        <div className="app-shell">
            <aside className="sidebar" aria-label="Primary navigation">
                <div className="sidebar__brand">ExpenseFlow</div>
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
                <main className="workspace__content">{children}</main>
            </div>
        </div>
    );
}

function DefaultWorkspaceScreen(): JSX.Element {
    return (
        <section className="screen-placeholder" aria-label="Screen content">
            <p className="screen-placeholder__label">Screen Region</p>
            <h2>Navigation-ready app shell</h2>
            <p>
                Operator and portal screens will render inside this shared
                frame.
            </p>
        </section>
    );
}

/**
 * Renders nested TanStack route content inside the app shell.
 */
export function RoutedWorkspaceOutlet(): JSX.Element {
    return <Outlet />;
}
