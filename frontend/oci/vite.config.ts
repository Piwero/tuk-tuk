import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5900,
    host: true,
    allowedHosts: true,
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
