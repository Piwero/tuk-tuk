import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

/** Cascade layers (issue #435). Layer order is fixed by whichever `@layer`
 * statement the browser meets first, and unlayered rules beat every layer,
 * so the convention only holds if: the entry stylesheet declares the order
 * and is the first thing main.tsx imports, and every per-component
 * stylesheet puts its rules inside `@layer components`. jsdom applies no
 * CSS, so this reads the sources off disk like tapTargetGuard.test.ts. */

const SRC = resolve(process.cwd(), "src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "").trim();

const ORDER = "@layer tokens, base, components, overrides;";

const componentSheets = readdirSync(join(SRC, "components")).filter((name) =>
  name.endsWith(".css"),
);
const ownedSheets = ["App.css", "AuthGate.css", ...componentSheets.map((n) => `components/${n}`)];

describe("stylesheet layers", () => {
  it("declares the layer order once, first, in the entry stylesheet", () => {
    expect(stripComments(read("index.css")).startsWith(ORDER)).toBe(true);
    const all = ["tokens.css", "base.css", ...componentSheets.map((n) => `components/${n}`)];
    for (const file of all) expect(read(file), file).not.toContain(ORDER);
  });

  it("imports the entry stylesheet before any component", () => {
    const firstImport = /^import .*$/m.exec(read("main.tsx"));
    expect(firstImport?.[0]).toBe('import "./index.css";');
  });

  it("keeps the entry declarative and loads self-hosted fonts from main (#439)", () => {
    expect(
      stripComments(read("index.css"))
        .replace(/@(?:layer|import)[^;]+;/g, "")
        .trim(),
    ).toBe("");
    expect(read("main.tsx")).toContain('import "./fonts.css";');
  });

  it("puts tokens and base styles in their layers", () => {
    const css = read("index.css");
    expect(css).toContain('@import "./tokens.css" layer(tokens);');
    expect(css).toContain('@import "./base.css" layer(base);');
  });

  it("has owning stylesheets for Tasks, sidebar and Quick-Add (#436)", () => {
    expect(componentSheets).toEqual(
      expect.arrayContaining([
        "TaskRow.css",
        "TaskListView.css",
        "TaskDetail.css",
        "KanbanView.css",
        "Sidebar.css",
        "CommandPalette.css",
        "QuickAdd.css",
        "TokenInput.css",
        "QuickAddDialog.css",
      ]),
    );
  });

  it("gives migrated views their own stylesheet (#438)", () => {
    for (const component of [
      "FocusView",
      "FocusStatsPanel",
      "HabitsView",
      "GoalsView",
      "StandupView",
      "SettingsView",
      "AssistantView",
      "AssistantPage",
      "VoiceView",
      "VoiceVisualizer",
      "VoiceOverlay",
    ]) {
      expect(componentSheets).toContain(`${component}.css`);
    }
  });

  it.each([...ownedSheets, "primitives.css"])("%s contains only layered rules", (sheet) => {
    expect(stripComments(read(sheet))).toMatch(/^@layer components \{[\s\S]*\}$/);
  });

  it.each(ownedSheets)("%s is imported by its owner", (sheet) => {
    const component = sheet.replace(/\.css$/, ".tsx");
    expect(read(component)).toContain(`import "./${sheet.split("/").pop()}";`);
  });
});
