// First: index.css declares the cascade-layer order, which only holds if it
// loads before any component stylesheet (#435).
import "./index.css";
import "./fonts.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AuthGate } from "./AuthGate";
import { applyThemePreference, loadThemePreference } from "./layoutPrefs";

// Before first paint, so the shell never flashes light on a dark preference.
applyThemePreference(loadThemePreference());

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
