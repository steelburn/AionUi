/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for src/cli/ui/termUtils.ts
 *
 * The implementation recognises the following ranges as double-width (2 cols):
 *   U+1100–U+115F  Hangul Jamo
 *   U+2E80–U+303E  CJK Radicals / Kangxi
 *   U+3041–U+33FF  Hiragana, Katakana, CJK symbols
 *   U+AC00–U+D7A3  Hangul Syllables
 *   U+F900–U+FAFF  CJK Compatibility Ideographs
 *   U+FE10–U+FE19  Vertical forms
 *   U+FE30–U+FE6F  CJK Compatibility Forms / Small Forms
 *   U+FF01–U+FF60  Fullwidth ASCII / Punctuation
 *   U+FFE0–U+FFE6  Fullwidth Signs
 *   U+20000–U+2A6DF CJK Extension B (surrogate pairs in UTF-16)
 *
 * U+3400–U+4DBF   CJK Extension A
 * U+4E00–U+9FFF   CJK Unified Ideographs (main block, e.g. 你好世界中)
 *
 * Test characters used:
 *   'あ'  U+3042  Hiragana (double-width, in 0x3041–0x33FF)
 *   'い'  U+3044  Hiragana (double-width)
 *   'う'  U+3046  Hiragana (double-width)
 *   'え'  U+3048  Hiragana (double-width)
 *   '가'  U+AC00  Hangul syllable (double-width, in 0xAC00–0xD7A3)
 *   '나'  U+B098  Hangul syllable (double-width)
 *   '！'  U+FF01  Fullwidth exclamation (double-width, in 0xFF01–0xFF60)
 *   'Ａ'  U+FF21  Fullwidth Latin A (double-width)
 *
 * Verifies:
 * 1. displayWidth() — ASCII strings count 1 col per char
 * 2. displayWidth() — double-width Hiragana chars count 2 cols each
 * 3. displayWidth() — mixed ASCII + double-width chars
 * 4. displayWidth() — empty string returns 0
 * 5. displayWidth() — ANSI escape codes are stripped when stripAnsi=true
 * 6. displayWidth() — ANSI escape codes are NOT stripped by default
 * 7. displayWidth() — Hangul syllables count as 2 cols
 * 8. displayWidth() — fullwidth ASCII variants count as 2 cols
 * 9. displayWidth() — emoji (outside all covered ranges) counts as 1 col
 * 10. displayWidth() — single space counts as 1 col
 * 11. truncateToWidth() — ASCII truncation
 * 12. truncateToWidth() — double-width char (Hiragana) aware truncation
 * 13. truncateToWidth() — string shorter than maxCols returned unchanged
 * 14. truncateToWidth() — exact fit returns full string unchanged
 * 15. truncateToWidth() — mixed ASCII + double-width truncation at boundary
 * 16. truncateToWidth() — zero width returns empty string
 * 17. truncateToWidth() — double-width char that would exceed width is skipped
 * 18. truncateToWidth() — empty input returns empty string
 * 19. truncateToWidth() — maxCols 1 with ASCII returns one char
 * 20. truncateToWidth() — maxCols 1 with double-width char returns empty string
 */

import { describe, it, expect } from 'vitest';
import { displayWidth, truncateToWidth } from '../../../src/cli/ui/termUtils';

// ---------------------------------------------------------------------------
// displayWidth
// ---------------------------------------------------------------------------

describe('displayWidth', () => {
  it('returns correct width for plain ASCII', () => {
    expect(displayWidth('hello')).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(displayWidth('')).toBe(0);
  });

  it('counts each Hiragana character as 2 columns (U+3041–U+33FF range)', () => {
    // あ = U+3042, い = U+3044 — both in the 0x3041–0x33FF double-width range
    expect(displayWidth('あい')).toBe(4);
  });

  it('handles mixed ASCII and Hiragana correctly', () => {
    // 'hello' = 5 cols, 'あい' = 4 cols → total 9
    expect(displayWidth('helloあい')).toBe(9);
  });

  it('strips ANSI SGR codes before measuring when stripAnsi=true', () => {
    // Bold on + 'hello' + reset → visible width should still be 5
    expect(displayWidth('\x1b[1mhello\x1b[0m', true)).toBe(5);
  });

  it('does NOT strip ANSI codes when stripAnsi=false (default)', () => {
    // The raw bytes of '\x1b[1m' count as individual ASCII characters (width 1 each)
    // '\x1b[1m' = ESC + '[' + '1' + 'm' = 4 bytes, 'hello' = 5, '\x1b[0m' = 4 bytes
    const raw = '\x1b[1mhello\x1b[0m';
    const widthWithEscapes = displayWidth(raw, false);
    // Must be greater than 5 since ANSI bytes are not stripped
    expect(widthWithEscapes).toBeGreaterThan(5);
  });

  it('counts a single space as 1 column', () => {
    expect(displayWidth(' ')).toBe(1);
  });

  it('counts Hangul syllables (U+AC00–U+D7A3) as 2 columns each', () => {
    // 가 = U+AC00, 나 = U+B098 — both are Hangul syllables
    expect(displayWidth('가나')).toBe(4);
  });

  it('counts fullwidth ASCII variants (U+FF01–U+FF60) as 2 columns each', () => {
    // ！ = U+FF01 (fullwidth !), Ａ = U+FF21 (fullwidth A)
    expect(displayWidth('！Ａ')).toBe(4);
  });

  it('counts a single Hiragana character as 2 columns', () => {
    expect(displayWidth('あ')).toBe(2);
  });

  it('handles emoji (outside all double-width ranges) — treated as width 1', () => {
    // U+1F600 GRINNING FACE is outside every covered range → width 1
    const emoji = '\u{1F600}';
    expect(displayWidth(emoji)).toBe(1);
  });

  it('handles a single ASCII character', () => {
    expect(displayWidth('a')).toBe(1);
  });

  it('handles a string of only spaces', () => {
    expect(displayWidth('   ')).toBe(3);
  });

  it('counts Hiragana + Hangul mixed string', () => {
    // あ (2) + 가 (2) + a (1) = 5
    expect(displayWidth('あ가a')).toBe(5);
  });

  it('counts CJK Unified Ideographs (U+4E00–U+9FFF) as 2 columns each', () => {
    // 你 = U+4F60, 好 = U+597D — both in the main CJK block
    expect(displayWidth('你好')).toBe(4);
  });

  it('counts mixed CJK Ideographs and ASCII correctly', () => {
    // '你好' = 4, 'world' = 5 → total 9
    expect(displayWidth('你好world')).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// truncateToWidth
// ---------------------------------------------------------------------------

describe('truncateToWidth', () => {
  it('truncates ASCII string to the given column count', () => {
    expect(truncateToWidth('hello', 3)).toBe('hel');
  });

  it('truncates Hiragana string respecting 2-column width per char', () => {
    // 'あいうえ' = 8 cols; truncate to 4 → 'あい' (2 + 2 = 4)
    expect(truncateToWidth('あいうえ', 4)).toBe('あい');
  });

  it('returns the string unchanged when it fits within maxCols', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello');
  });

  it('returns the string unchanged when length exactly equals maxCols', () => {
    // 'hello' = 5 cols; maxCols = 5 → no truncation
    expect(truncateToWidth('hello', 5)).toBe('hello');
  });

  it('truncates mixed ASCII + Hiragana at the correct column boundary', () => {
    // 'hello' = 5 cols + 'あい' = 4 cols → 9 total; truncate to 7 → 'helloあ' (5 + 2 = 7)
    expect(truncateToWidth('helloあい', 7)).toBe('helloあ');
  });

  it('returns empty string when maxCols is 0', () => {
    expect(truncateToWidth('hello', 0)).toBe('');
    expect(truncateToWidth('あい', 0)).toBe('');
  });

  it('skips a double-width character entirely when only 1 column remains', () => {
    // 'あい' each is 2 cols; maxCols = 3 → only 'あ' fits (2 cols); remaining 1 col cannot fit 'い'
    expect(truncateToWidth('あい', 3)).toBe('あ');
  });

  it('handles an empty input string', () => {
    expect(truncateToWidth('', 5)).toBe('');
  });

  it('handles maxCols of 1 with ASCII', () => {
    expect(truncateToWidth('abc', 1)).toBe('a');
  });

  it('handles maxCols of 1 with a double-width char — nothing fits', () => {
    // A Hiragana char is 2 cols wide, so nothing fits in 1 col
    expect(truncateToWidth('あい', 1)).toBe('');
  });

  it('handles maxCols of 2 fitting exactly one double-width char', () => {
    expect(truncateToWidth('あいうえ', 2)).toBe('あ');
  });

  it('handles a Hangul syllable string truncation', () => {
    // '가나다라' = 8 cols; truncate to 6 → '가나다' (2 + 2 + 2 = 6)
    expect(truncateToWidth('가나다라', 6)).toBe('가나다');
  });

  it('handles ASCII followed by double-width chars with boundary on ASCII char', () => {
    // 'ab' = 2 cols + 'あ' = 2 cols; truncate to 3 → 'ab' (2 cols, 'あ' would need 2 more)
    expect(truncateToWidth('abあ', 3)).toBe('ab');
  });
});
