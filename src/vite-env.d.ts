/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Semantic version from package.json — bump with npm run version:patch|minor|major */
  readonly VITE_APP_VERSION: string;
  /** Build stamp (date + git short SHA) — updates automatically on each production build */
  readonly VITE_APP_BUILD_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
