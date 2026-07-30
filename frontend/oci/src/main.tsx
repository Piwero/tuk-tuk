import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AuthGate } from "./AuthGate";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
