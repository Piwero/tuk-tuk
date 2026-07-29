/** Shared pure helpers behind every Quick-Add sigil's suggestion module
 * (`tagSuggest.ts`, `listSuggest.ts`, `prioritySuggest.ts`). */

/** Finds the start of the whitespace-delimited word touching the caret —
 * scans left until a space or the start of the input. */
export function wordStart(text: string, caret: number): number {
  let index = caret;
  while (index > 0 && !/\s/.test(text[index - 1] as string)) {
    index -= 1;
  }
  return index;
}

/** The part of a suggestion an `applyPick` needs to strip the sigil+query
 * text — every sigil's suggestion type structurally satisfies this. */
export interface SigilPosition {
  start: number;
  query: string;
}
