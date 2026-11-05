import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { fakeVoiceTransport } from "./test/fakeVoiceTransport";

beforeEach(() => window.history.replaceState(null, "", "/assistant"));

it("shares one session and captions across the page and dismissible overlay", async () => {
  installFakeApi({
    voiceLivekitUrl: "wss://test.livekit.cloud",
    voiceLivekitApiKey: "key",
    voiceSecretSet: true,
  });
  const fake = fakeVoiceTransport();
  const user = userEvent.setup();
  render(<App voiceProvider={fake.provider} />);
  fireEvent.pointerDown(await screen.findByRole("button", { name: "Press to connect" }));
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  act(() => fake.transports[0]!.events.onAgent({ speaking: false, contractVersion: "1" }));
  const opener = await screen.findByRole("button", { name: "Open voice overlay" });
  await user.click(opener);
  const panel = screen.getByRole("region", { name: "Voice overlay" });
  expect(within(panel).getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  act(() =>
    fake.transports[0]!.events.onUtterance(
      (async function* () {
        yield "Hello";
      })(),
    ),
  );
  expect(await within(panel).findByText("Hello")).toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "Close voice overlay" }));
  expect(opener).toHaveFocus();
  expect(fake.transports).toHaveLength(1);
  expect(fake.transports[0]!.connected).toBe(true);
  expect(screen.getByText("Hello")).toBeInTheDocument();
});

it("shortcut respects editing and dialogs, toggles without connecting, and Escape restores focus", async () => {
  installFakeApi({
    voiceLivekitUrl: "wss://test.livekit.cloud",
    voiceLivekitApiKey: "key",
    voiceSecretSet: true,
  });
  const fake = fakeVoiceTransport();
  render(<App voiceProvider={fake.provider} />);
  const opener = await screen.findByRole("button", { name: "Open voice overlay" });
  const input = document.createElement("input");
  document.body.append(input);
  fireEvent.keyDown(input, { key: "V", altKey: true, shiftKey: true });
  expect(screen.queryByRole("region", { name: "Voice overlay" })).not.toBeInTheDocument();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  fireEvent.keyDown(dialog, { key: "V", altKey: true, shiftKey: true });
  expect(screen.queryByRole("region", { name: "Voice overlay" })).not.toBeInTheDocument();
  opener.focus();
  fireEvent.keyDown(opener, { key: "◊", code: "KeyV", altKey: true, shiftKey: true });
  const panel = screen.getByRole("region", { name: "Voice overlay" });
  expect(fake.transports).toHaveLength(0);
  fireEvent.keyDown(within(panel).getByRole("button", { name: "Close voice overlay" }), {
    key: "Escape",
  });
  expect(opener).toHaveFocus();
  input.remove();
  dialog.remove();
});

it("cancels a held turn on dismissal and hides on navigation without disconnecting", async () => {
  installFakeApi({
    voiceLivekitUrl: "wss://test.livekit.cloud",
    voiceLivekitApiKey: "key",
    voiceSecretSet: true,
  });
  const fake = fakeVoiceTransport();
  const user = userEvent.setup();
  render(<App voiceProvider={fake.provider} />);
  await user.click(await screen.findByRole("button", { name: "Open voice overlay" }));
  let panel = screen.getByRole("region", { name: "Voice overlay" });
  fireEvent.pointerDown(within(panel).getByRole("button", { name: "Press to connect" }));
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  act(() => fake.transports[0]!.events.onAgent({ speaking: false, contractVersion: "1" }));
  fireEvent.pointerDown(await within(panel).findByRole("button", { name: "Hold to talk" }));
  await waitFor(() => expect(fake.transports[0]!.turns).toContain("start"));
  fireEvent.keyDown(within(panel).getByRole("button", { name: "Release to send" }), {
    key: "Escape",
  });
  await waitFor(() => expect(fake.transports[0]!.turns).toContain("cancel"));
  expect(fake.transports[0]!.connected).toBe(true);
  await user.click(screen.getByRole("button", { name: "Open voice overlay" }));
  panel = screen.getByRole("region", { name: "Voice overlay" });
  await user.click(
    within(screen.getByRole("navigation", { name: "Smart Lists" })).getByRole("button", {
      name: "All",
    }),
  );
  expect(panel).not.toBeInTheDocument();
  expect(fake.transports[0]!.connected).toBe(true);
});
