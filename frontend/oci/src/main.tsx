import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AuthGate } from "./AuthGate";
import { applyThemePreference, loadThemePreference } from "./layoutPrefs";
import "./index.css";

// Before first paint, so the shell never flashes light on a dark preference.
applyThemePreference(loadThemePreference());

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
