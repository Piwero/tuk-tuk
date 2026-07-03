import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the title", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("App");
  });
});
