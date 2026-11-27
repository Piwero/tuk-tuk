import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

async function review(titles: string[], existing: string[] = []) {
  const task = fakeTask("Review task", {
    check_items: existing.map((title, i) => ({
      id: i + 1,
      title,
      done: false,
      sort_order: i * 1024,
    })),
  });
  const api = installFakeApi({ tasks: [task] });
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  const writes: { title: string; request_id: string }[] = [];
  let failAt = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/assistant/config"))
      return new Response(
        JSON.stringify({
          base_url: "https://provider.example/v1",
          model: "configured-model",
          api_key_set: true,
        }),
      );
    if (url.endsWith("/assistant/check-item-suggestions"))
      return new Response(
        JSON.stringify({
          message: "Steps",
          suggestions: [{ type: "add_check_items", task_id: task.id, check_item_titles: titles }],
        }),
      );
    if (url.endsWith("/check-items") && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      if (writes.length === failAt) throw new TypeError("Response lost");
    }
    return original(input, init);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Open details for Review task" }));
  await user.click(await screen.findByRole("button", { name: "Suggest Check Items" }));
  const region = screen.getByRole("region", { name: "Check Item Suggestions" });
  await user.click(within(region).getByRole("button", { name: "Suggest steps" }));
  await within(region).findByLabelText("Step 1.1");
  return {
    user,
    region,
    writes,
    api,
    failOn: (n: number) => {
      failAt = n;
    },
  };
}

it("requires explicit duplicate choice and discard writes nothing", async () => {
  const { user, region, writes } = await review(["Pack socks"], ["Pack socks"]);
  expect(within(region).getByRole("button", { name: "Add" })).toBeDisabled();
  await user.click(within(region).getByRole("checkbox", { name: /Keep duplicates/ }));
  expect(within(region).getByRole("button", { name: "Add" })).toBeEnabled();
  await user.click(within(region).getByRole("button", { name: "Discard" }));
  expect(writes).toHaveLength(0);
});

it("partial group retry preserves identifiers and skips confirmed saved prefix", async () => {
  const { user, region, writes, failOn } = await review(["Pack socks", "Pack charger"]);
  failOn(2);
  await user.click(within(region).getByRole("button", { name: "Add" }));
  expect(await within(region).findByText(/1 confirmed saved/)).toBeInTheDocument();
  expect(within(region).getByLabelText("Step 1.2")).toBeDisabled();
  await user.click(within(region).getByRole("button", { name: "Retry Add" }));
  expect(await within(region).findByText("Saved 2 Check Items.")).toBeInTheDocument();
  expect(writes).toHaveLength(3);
  expect(writes[2]).toEqual(writes[1]);
  expect(within(region).getByRole("button", { name: "Add" })).toBeDisabled();
});

it("requires duplicate consent when manual entry follows a failed acceptance", async () => {
  const { user, region, writes, failOn } = await review(["Pack socks"]);
  failOn(1);
  await user.click(within(region).getByRole("button", { name: "Add" }));
  await within(region).findByText(/0 confirmed saved/);
  await user.type(screen.getByRole("textbox", { name: "Add a check item" }), "Pack socks{Enter}");
  const retry = within(region).getByRole("button", { name: "Retry Add" });
  expect(retry).toBeDisabled();
  const consent = within(region).getByRole("checkbox", { name: /Keep duplicates/ });
  expect(consent).toBeEnabled();
  await user.click(consent);
  await user.click(retry);
  expect(await within(region).findByText("Saved 1 Check Item.")).toBeInTheDocument();
  expect(writes[2]).toEqual(writes[0]);
});

it("cancel drops preview without writes and returns focus to opener", async () => {
  const { user, region, writes } = await review(["Pack socks"]);
  await user.click(within(region).getByRole("button", { name: "Cancel suggestions" }));
  expect(screen.queryByRole("region", { name: "Check Item Suggestions" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suggest Check Items" })).toHaveFocus();
  expect(writes).toHaveLength(0);
});
it("discloses selected context, previews editable steps, and writes only on Add", async () => {
  const task = fakeTask("Pack bags");
  installFakeApi({ tasks: [task] });
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  const writes: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/assistant/config"))
      return new Response(
        JSON.stringify({
          base_url: "http://localhost:11434",
          model: "local-model",
          api_key_set: true,
        }),
      );
    if (url.endsWith("/assistant/check-item-suggestions"))
      return new Response(
        JSON.stringify({
          message: "Steps",
          suggestions: [
            { type: "add_check_items", task_id: task.id, check_item_titles: ["Pack socks"] },
          ],
        }),
      );
    if (url.endsWith("/check-items") && init?.method === "POST")
      writes.push(JSON.parse(String(init.body)));
    return original(input, init);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Open details for Pack bags" }));
  await user.click(await screen.findByRole("button", { name: "Suggest Check Items" }));
  const region = screen.getByRole("region", { name: "Check Item Suggestions" });
  expect(within(region).getByText(/Only this Task/)).toBeInTheDocument();
  expect(within(region).getByText(/Local processing/)).toBeInTheDocument();
  expect(within(region).getByLabelText("Number of steps")).toHaveValue("3");
  await user.click(within(region).getByRole("button", { name: "Suggest steps" }));
  const title = await within(region).findByLabelText("Step 1.1");
  expect(writes).toHaveLength(0);
  await user.clear(title);
  await user.type(title, "Pack charger");
  await user.click(within(region).getByRole("button", { name: "Add" }));
  expect(await within(region).findByText("Saved 1 Check Item.")).toBeInTheDocument();
  expect(writes).toEqual([{ title: "Pack charger", request_id: expect.any(String) }]);
});
