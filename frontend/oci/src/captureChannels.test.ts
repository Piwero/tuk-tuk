import { describe, expect, it, vi } from "vitest";

import {
  makeDateChannel,
  makeListChannel,
  makePriorityChannel,
  makeTagChannel,
} from "./captureChannels";
import { resolveDayToken } from "./dateSuggest";
import { fakeList, fakeTag } from "./test/fakeApi";

const NOW = new Date("2026-09-02T12:00:00Z");

describe("capture channel factories", () => {
  it("stamp the right sigil and mode on each channel", () => {
    expect(
      makeTagChannel(
        [],
        [],
        () => {},
        () => {},
      ),
    ).toMatchObject({ sigil: "#", mode: "multi" });
    expect(
      makeListChannel(
        [],
        [],
        () => {},
        () => {},
      ),
    ).toMatchObject({ sigil: "~", mode: "single" });
    expect(makePriorityChannel([], () => {})).toMatchObject({ sigil: "!", mode: "single" });
    expect(makeDateChannel([], () => {}, NOW)).toMatchObject({ sigil: "@", mode: "single" });
  });

  it("give only the @date channel a mergePick — every other channel replaces on pick", () => {
    expect(
      makeTagChannel(
        [],
        [],
        () => {},
        () => {},
      ).mergePick,
    ).toBeUndefined();
    expect(
      makeListChannel(
        [],
        [],
        () => {},
        () => {},
      ).mergePick,
    ).toBeUndefined();
    expect(makePriorityChannel([], () => {}).mergePick).toBeUndefined();
    expect(makeDateChannel([], () => {}, NOW).mergePick).toBeInstanceOf(Function);
  });

  it("offer a Create row only where a new item can be made", () => {
    expect(
      makeTagChannel(
        [],
        [],
        () => {},
        () => {},
      ).allowCreate,
    ).toBe(true);
    expect(
      makeListChannel(
        [],
        [],
        () => {},
        () => {},
      ).allowCreate,
    ).toBe(true);
    expect(makePriorityChannel([], () => {}).allowCreate).toBe(false);
    expect(makeDateChannel([], () => {}, NOW).allowCreate).toBe(false);
  });

  it("pass the caller's chips and onChipsChange straight through", () => {
    const chips = [fakeTag("urgent", { id: 3 })];
    const onChange = vi.fn();
    const channel = makeTagChannel([], chips, onChange, () => {});
    expect(channel.chips).toBe(chips);
    channel.onChipsChange([]);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("resolve the @date dropdown against the injected clock", () => {
    const channel = makeDateChannel([], () => {}, NOW);
    const suggestion = channel.suggest("@tomorrow", "@tomorrow".length);
    expect(suggestion?.options[0]).toEqual(resolveDayToken("tomorrow", NOW));
  });

  it("suggest tags and lists from the vocab the caller supplies", () => {
    const tags = [fakeTag("home", { id: 1 }), fakeTag("work", { id: 2 })];
    const lists = [fakeList("Errands", { id: 10 })];
    expect(
      makeTagChannel(
        tags,
        [],
        () => {},
        () => {},
      ).suggest("#ho", 3)?.options,
    ).toEqual([tags[0]]);
    expect(
      makeListChannel(
        lists,
        [],
        () => {},
        () => {},
      ).suggest("~Err", 4)?.options,
    ).toEqual(lists);
  });
});
