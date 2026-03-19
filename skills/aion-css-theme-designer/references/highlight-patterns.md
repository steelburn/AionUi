# Highlight Patterns

These patterns are reusable reference templates for all Aion theme generation modes, not only image-driven generation.

In Aion chat themes, the most reliable "high attention but still elegant" pattern is not plain bold text. It is an **inline code chip**.

## Recommended default

Pattern name: `soft-brand-inline-chip`

Use this when the user wants subtle emphasis for:

- file names
- repo names
- commands
- dates
- short labels
- key nouns inside assistant replies

## Selector pattern

Prefer targeting inline code inside markdown:

```css
.markdown-shadow-body code:not(pre code),
[class*='markdown'] code:not(pre code) {
  background: var(--brand-light) !important;
  color: var(--brand) !important;
  border: 1px solid var(--aou-3) !important;
  border-radius: 4px !important;
  padding: 1px 5px !important;
  font-size: 0.88em !important;
}

[data-theme='dark'] .markdown-shadow-body code:not(pre code),
[data-theme='dark'] [class*='markdown'] code:not(pre code) {
  background: var(--brand-light) !important;
  color: var(--brand) !important;
  border-color: var(--aou-4) !important;
}
```

## Why this works

- It creates a visible but low-area emphasis shape
- It integrates with the theme brand family
- It works well in dense assistant prose
- It scales better than strong `mark` highlights
- It is easier to keep readable in both light and dark mode

## Design rules

- Use a light semantic background in light mode and a darker paired semantic background in dark mode
- Keep the padding small
- Keep the border subtle
- Do not make the chip too tall or too heavy
- Do not use this style for long phrases or full sentences

## Anti-patterns

Avoid these by default:

- emphasis that only changes `font-weight`
- dark chips with low-contrast text
- large pastel rectangles around long content
- bright yellow `mark` styles in low-saturation themes

## Mapping note

If the user references "the successful Y2K highlight behavior", translate that request to:

- inline code chip
- brand-derived foreground and background
- thin border
- light and dark mode tuned separately through semantic variables
