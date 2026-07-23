import { ComponentShowcase } from "./components";

const navigationItems = ["Case Queue", "Employee Portal", "Administration"];

/**
 * Renders the persistent ExpenseFlow application shell.
 */
export default function App(): JSX.Element {
    return (
        <div className="app-shell">
            <aside className="sidebar" aria-label="Primary navigation">
                <div className="sidebar__brand">ExpenseFlow</div>
                <nav className="sidebar__nav" aria-label="Workspace sections">
                    {navigationItems.map((item) => (
                        <span
                            aria-disabled="true"
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
                        <p className="topbar__eyebrow">Read-models/BFF</p>
                        <h1>ExpenseFlow Workspace</h1>
                    </div>
                    <div className="topbar__tenant">Operator Shell</div>
                </header>
                <main className="workspace__content">
                    <section
                        className="screen-placeholder"
                        aria-label="Screen content"
                    >
                        <ComponentShowcase />
                    </section>
                </main>
            </div>
        </div>
    );
}
