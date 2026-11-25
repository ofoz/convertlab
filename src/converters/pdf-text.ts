/**
 * Maps CJK compatibility ideographs to the characters users expect without
 * touching full-width punctuation or other deliberately encoded glyphs.
 * PDF font subsets commonly expose radicals such as U+2F29 instead of 小.
 */
export function normalizePdfText(value: string): string {
  return value.replace(/[\u2e80-\u2fff\uf900-\ufaff]/g, (character) => character.normalize('NFKC'));
}
