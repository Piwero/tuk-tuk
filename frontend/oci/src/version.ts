/** The running app's version, baked in at build time from the release tag
 * (see frontend/oci/Dockerfile's VITE_APP_VERSION build arg, set from the
 * git tag by the release workflow). Falls back to "dev" for local dev
 * servers and the test suite, where nothing sets it. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || "dev";
