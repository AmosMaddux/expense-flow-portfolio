---
name: Systematic Precision
colors:
    surface: "#f7f9fb"
    surface-dim: "#d8dadc"
    surface-bright: "#f7f9fb"
    surface-container-lowest: "#ffffff"
    surface-container-low: "#f2f4f6"
    surface-container: "#eceef0"
    surface-container-high: "#e6e8ea"
    surface-container-highest: "#e0e3e5"
    on-surface: "#191c1e"
    on-surface-variant: "#44474c"
    inverse-surface: "#2d3133"
    inverse-on-surface: "#eff1f3"
    outline: "#75777d"
    outline-variant: "#c4c6cd"
    surface-tint: "#515f74"
    primary: "#303e51"
    on-primary: "#ffffff"
    primary-container: "#475569"
    on-primary-container: "#bbcae1"
    inverse-primary: "#b9c7df"
    secondary: "#006c49"
    on-secondary: "#ffffff"
    secondary-container: "#6cf8bb"
    on-secondary-container: "#00714d"
    tertiary: "#583500"
    on-tertiary: "#ffffff"
    tertiary-container: "#774a00"
    on-tertiary-container: "#ffbb66"
    error: "#ba1a1a"
    on-error: "#ffffff"
    error-container: "#ffdad6"
    on-error-container: "#93000a"
    primary-fixed: "#d5e3fc"
    primary-fixed-dim: "#b9c7df"
    on-primary-fixed: "#0d1c2e"
    on-primary-fixed-variant: "#3a485b"
    secondary-fixed: "#6ffbbe"
    secondary-fixed-dim: "#4edea3"
    on-secondary-fixed: "#002113"
    on-secondary-fixed-variant: "#005236"
    tertiary-fixed: "#ffddb8"
    tertiary-fixed-dim: "#ffb95f"
    on-tertiary-fixed: "#2a1700"
    on-tertiary-fixed-variant: "#653e00"
    background: "#f7f9fb"
    on-background: "#191c1e"
    surface-variant: "#e0e3e5"
typography:
    headline-lg:
        fontFamily: Inter
        fontSize: 24px
        fontWeight: "600"
        lineHeight: 32px
        letterSpacing: -0.02em
    headline-md:
        fontFamily: Inter
        fontSize: 20px
        fontWeight: "600"
        lineHeight: 28px
        letterSpacing: -0.01em
    headline-sm:
        fontFamily: Inter
        fontSize: 16px
        fontWeight: "600"
        lineHeight: 24px
    body-lg:
        fontFamily: Inter
        fontSize: 16px
        fontWeight: "400"
        lineHeight: 24px
    body-md:
        fontFamily: Inter
        fontSize: 14px
        fontWeight: "400"
        lineHeight: 20px
    body-sm:
        fontFamily: Inter
        fontSize: 12px
        fontWeight: "400"
        lineHeight: 16px
    label-md:
        fontFamily: JetBrains Mono
        fontSize: 12px
        fontWeight: "500"
        lineHeight: 16px
        letterSpacing: 0.02em
    label-sm:
        fontFamily: JetBrains Mono
        fontSize: 10px
        fontWeight: "500"
        lineHeight: 12px
rounded:
    sm: 0.125rem
    DEFAULT: 0.25rem
    md: 0.375rem
    lg: 0.5rem
    xl: 0.75rem
    full: 9999px
spacing:
    base: 4px
    xs: 4px
    sm: 8px
    md: 16px
    lg: 24px
    xl: 32px
    sidebar_width: 260px
    header_height: 64px
    container_max_width: 1440px
---

## Brand & Style

The design system is engineered for high-density information environments where clarity and data integrity are paramount. The brand personality is professional, utilitarian, and dependable, catering to finance teams and corporate employees who require a frictionless expense reporting experience.

The visual style follows a **Corporate / Modern** approach with a focus on **Tonal Minimalism**. It prioritizes structural hierarchy over decorative elements. By utilizing a grayscale-heavy aesthetic with strategic semantic accents, the UI ensures that critical status information and calls-to-action remain the focal points of the user experience.

## Colors

This design system employs a disciplined color palette centered around Slate Blue-Grays to maintain a professional atmosphere.

- **Primary (Slate Blue/Gray):** Used for navigation, headers, and primary actions. It communicates stability.
- **Success (Emerald):** Reserved for "Approved" and "Paid" statuses, as well as final confirmation actions.
- **Warning (Amber):** Highlights "Flagged" expenses or items requiring "Manager Approval."
- **Error (Crimson):** Indicates "Rejected" reports or validation errors.
- **Surface & Backgrounds:** The main application background uses a very light gray (`#f8fafc`) to provide subtle contrast against white cards and form containers, reducing eye strain during long sessions.

## Typography

The typography system relies on **Inter** for its exceptional legibility in data-heavy interfaces and its neutral, modern tone. For technical data points—such as transaction IDs, currency amounts, and status badges—**JetBrains Mono** is utilized to provide a distinct, tabular feel that aids in scanning columns of figures.

Text styles are strictly hierarchical. Headlines use tighter letter-spacing for a grounded appearance, while labels use monospaced formatting to ensure that numbers align perfectly in vertical lists.

## Layout & Spacing

The design system is built on a rigorous **8px grid** (with a 4px sub-step for fine-tuning).

- **Layout Structure:** A persistent 260px left sidebar houses the primary navigation. The top header (64px) provides global context including the current tenant/organization and user profile.
- **Grid:** A 12-column fluid grid is used for the main content area. Data tables typically span the full 12 columns, while KPI cards and form inputs are grouped into 3 or 4-column clusters.
- **Responsive Behavior:**
    - **Desktop (>1024px):** Fixed sidebar, full 12-column grid.
    - **Tablet (768px - 1023px):** Sidebar collapses to icons; margins reduce to 16px.
    - **Mobile (<768px):** Sidebar becomes a hidden drawer; 4-column grid; vertical stacking for KPI cards and form groups.

## Elevation & Depth

To maintain a clean, "flat-plus" aesthetic, this design system avoids heavy drop shadows. Instead, it uses **Tonal Layering** and **Low-Contrast Outlines**:

- **Level 0 (Background):** `#f8fafc` — The canvas layer.
- **Level 1 (Cards/Sheets):** White background with a 1px solid border (`#e2e8f0`). No shadow. Used for data tables and list items.
- **Level 2 (KPIs/Popovers):** White background with a subtle, diffused 4px blur shadow (Color: `Slate-900`, Opacity: 4%) to indicate slight elevation.
- **Level 3 (Modals/Overlays):** White background with a 12px blur shadow (Opacity: 8%) to draw focus over the dimming backdrop.

## Shapes

A "Soft" shape language is applied to bridge the gap between rigid corporate structures and modern accessibility.

- **Standard Elements (Inputs, Buttons):** 0.25rem (4px) corner radius.
- **Containers (Cards, Modals):** 0.5rem (8px) corner radius.
- **Status Badges:** Fully rounded (pill-shaped) to distinguish them from interactive buttons.
- **Active Indicators:** 2px vertical bars on the left of active sidebar items.

## Components

### Buttons

- **Primary:** Solid Slate Blue (`#475569`), white text. Used for "Submit Expense."
- **Secondary:** White background, 1px border (`#e2e8f0`), Slate Blue text. Used for "Save Draft."
- **Ghost:** No background/border in default state; light gray hover. Used for table actions.
- **Danger:** Solid Crimson Red (`#dc2626`). Used for "Delete" or "Reject."

### Form Inputs

- **Text/Select/Date:** 1px border (`#e2e8f0`). On focus, border changes to Primary Slate with a subtle outer ring.
- **File Upload:** A dashed-border dropzone with a centered icon and "Upload Receipt" text.

### Status Badges

Pill-shaped with light background tints and dark text for contrast:

- **Drafted:** Gray background / Dark Gray text.
- **Submitted:** Blue background / Blue text.
- **Approved/Paid:** Green background / Dark Green text.
- **Flagged/Warning:** Amber background / Brown text.

### Progress Stepper (6-Stage)

Horizontal layout with a thin connector line.

- **Completed:** Solid circle with checkmark.
- **Active:** Outlined circle with Primary color fill.
- **Pending:** Gray outlined circle with label in `body-sm`.

### Data Tables & KPI Cards

- **KPI Cards:** Prominent `headline-lg` value for the metric (e.g., "Total Pending"), with a `label-sm` subtitle.
- **Tables:** Header row uses a light gray background (`#f1f5f9`). Rows use alternating "Zebra" stripes or a simple border-bottom for high-density reading.

### Loading & Empty States

- **Skeletons:** Pulse-animated light gray blocks mirroring the component's geometry.
- **Empty States:** Centered illustration (grayscale) with a clear primary action button to "Add First Expense."
