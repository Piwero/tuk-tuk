import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

beforeEach(() => localStorage.clear());

it("offers mode and length presets without a setup form", async () => {
  installFakeApi();
  window.history.replaceState(null, "", "/focus");
  render(<App />);
  const main = within(screen.getByRole("main"));
  expect(await main.findByRole("button", { name: "Pomo", pressed: true })).toBeInTheDocument();
  expect(main.queryByRole("combobox")).not.toBeInTheDocument();
  expect(main.queryByRole("spinbutton")).not.toBeInTheDocument();
  for (const minutes of [15, 25, 50, 90]) {
    fireEvent.click(main.getByRole("button", { name: `${minutes} min` }));
    expect(main.getByText(`${minutes}:00`)).toBeInTheDocument();
  }
  fireEvent.click(main.getByRole("button", { name: "Custom" }));
  fireEvent.change(main.getByRole("spinbutton", { name: "Pomo minutes" }), {
    target: { value: "35" },
  });
  expect(main.getByText("35:00")).toBeInTheDocument();
  fireEvent.click(main.getByRole("button", { name: "Stopwatch" }));
  expect(main.getByText("00:00")).toBeInTheDocument();
});

it("toggles start, pause and resume with Space", async () => {
  installFakeApi();
  window.history.replaceState(null, "", "/focus");
  render(<App />);
  const main = within(screen.getByRole("main"));
  await main.findByRole("button", { name: "Start" });
  fireEvent.keyDown(document.body, { key: " " });
  expect(main.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: " " });
  expect(main.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: " " });
  expect(main.getByRole("button", { name: "Pause" })).toBeInTheDocument();
});
