import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// jsdom's location/history persists across tests within a file — reset it so
// a pushState left over from one test (e.g. clicking Calendar) never leaks
// into the next test's initial render (issue #143's URL routing reads
// window.location.pathname on mount).
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
