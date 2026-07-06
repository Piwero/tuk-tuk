/** Test doubles for HTML5 drag-and-drop, shared across suites. */

export function fakeDataTransfer(): Pick<DataTransfer, "setData" | "getData"> {
  const store: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? "",
  };
}

/** Nearest ancestor matching `selector`, throwing when the DOM shape changes. */
export function closestOrThrow(element: HTMLElement, selector: string): HTMLElement {
  const match = element.closest(selector);
  if (!(match instanceof HTMLElement)) {
    throw new Error(`No ancestor matching ${selector}`);
  }
  return match;
}
