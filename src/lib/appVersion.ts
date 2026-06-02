/** Semantic release version (package.json). */
export const APP_SEMVER = import.meta.env.VITE_APP_VERSION;

/** Auto-generated on each build (YYYYMMDD + git commit). */
export const APP_BUILD_ID = import.meta.env.VITE_APP_BUILD_ID;

/** Full version code for support and tooltips (e.g. v1.2.3+20260602.a1b2c3d). */
export const APP_VERSION_CODE = `v${APP_SEMVER}+${APP_BUILD_ID}`;

/** Compact label for the header. */
export const APP_VERSION_LABEL = `v${APP_SEMVER}`;
