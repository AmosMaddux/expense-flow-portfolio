/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_FINANCE_DASHBOARD_AS_OF_DATE?: string;
    readonly VITE_TENANT_ID?: string;
    readonly VITE_SECONDARY_TENANT_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
