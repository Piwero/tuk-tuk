import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5900,
    host: true,
    allowedHosts: true,
    // The dev server proxies the API so the browser only ever calls the origin
    // it loaded from. Without this, a page opened at a LAN / tailnet address
    // would resolve an absolute VITE_API_BASE_URL of localhost:8900 against the
    // *client* device, and the backend's CORS allow-list (localhost only) would
    // reject the origin anyway. `backend` is the compose service name.
    proxy: {
      "/api": { target: "http://backend:8900", changeOrigin: true },
      "/health": { target: "http://backend:8900", changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Pin the suite to UTC: the calendar tests assume local wall-clock times
    // equal their stored UTC instants (see pinCalendarClock), which only holds
    // when the runner's timezone is UTC.
    env: { TZ: "UTC" },
  },
});
