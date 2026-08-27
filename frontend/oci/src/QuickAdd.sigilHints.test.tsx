import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeList, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

async function openInbox(): Promise<void> {
  await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));
}

describe("Quick-Add sigil hints (issue #197)", () => {
  it("shows ghost hints for the #tag, !priority and ~list sigils at rest", async () => {
    installFakeApi();
    render(<App />);
    await openInbox();

    const hints = document.querySelector(".quick-add-sigil-hints");
    expect(hints).not.toBeNull();
    expect(hints?.textContent).toContain("#tag");
    expect(hints?.textContent).toContain("!priority");
    expect(hints?.textContent).toContain("~list");
  });

  it("marks the hints decorative (aria-hidden) and keeps them out of the tab order", async () => {
    installFakeApi();
    render(<App />);
    await openInbox();

    const hints = document.querySelector(".quick-add-sigil-hints");
    expect(hints?.getAttribute("aria-hidden")).toBe("true");
    // No focusable descendants — not a control.
    expect(hints?.querySelector("button, a, input, [tabindex]")).toBeNull();
  });

  it("flags the hints as receded once the field has content", async () => {
    installFakeApi();
    render(<App />);
    await openInbox();
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    const hints = document.querySelector(".quick-add-sigil-hints");
    expect(hints?.getAttribute("data-has-content")).toBeNull();

    await user.type(input, "buy milk");
    await waitFor(() =>
      expect(
        document.querySelector(".quick-add-sigil-hints")?.getAttribute("data-has-content"),
      ).toBe("true"),
    );
  });

  it("still parses each sigil into a structured field", async () => {
    const personal = fakeList("Personal");
    const api = installFakeApi({ lists: [INBOX, personal] });
    render(<App />);
    await openInbox();
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "pay rent #finance !high ~Personal{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    const finance = api.tags.find((tag) => tag.name === "finance");
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent",
      list_id: personal.id,
      priority: "high",
      tag_ids: [finance?.id],
    });
  });
});
