/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin, e.g. http://localhost:4000. Falls back to same-origin /api proxy. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
