# Aion CSS Theme Rules

These rules are specific to AionUi's custom CSS theme system.

## 0. Reference template philosophy

Use the previously successful Aion theme structure as a **reference template**.

Important:

- this is a structural reference, not a visual style preset
- do not clone the old palette unless the user asks for it
- do reuse the output logic that makes the theme obviously effective in AionUi

That means the template should guide:

- what layers must exist
- which selectors are high-value
- which areas must be separately tuned in dark mode
- how inline emphasis should work in chat

It should **not** force every output into a small-delta theme.

If the user wants a strong transformation, use the template only to preserve effectiveness, while allowing the visual language to change broadly.

## 1. Theme structure

Generate themes in two required layers:

- `:root` for light mode
- `[data-theme='dark']` for dark mode

Do not rely on one mode inheriting safely from the other. Define both intentionally.

## 2. Semantic variable priority

The most important variables to define are:

- `--color-primary`
- `--primary`
- `--brand`
- `--brand-light`
- `--bg-base`
- `--bg-1` to `--bg-4`
- `--text-primary`
- `--text-secondary`
- `--border-base`
- `--fill`
- `--message-user-bg`
- `--message-tips-bg`

If the theme has a clear aesthetic, express it through these semantic variables first.

## 3. Component override priority

After variables, only override the most visible areas:

- markdown headings
- markdown links
- inline `code`
- code blocks
- user and assistant bubbles
- sidebar
- sendbox and inputs
- selection
- scrollbar

Avoid broad overrides of generic `.arco-*` selectors unless necessary.

## 3.2 Depth model

Theme generation should follow one of three depth levels:

### Accent-only

Change mainly:

- links
- inline chips
- code blocks
- headings
- bubbles

### Balanced theme

Also change:

- header and sidebar surfaces
- buttons
- inputs
- cards
- selected and hover states

### Full reskin

Also change:

- page atmosphere (`body`, overlays, ambient gradients, texture)
- major containers
- modal and popup surfaces
- file panels
- sendbox visual language
- visual density and component personality

If the user asks for "整个皮肤都变", "整体风格明显改变", or complains that only small details changed, use **full reskin**.

Also treat these as strong signals for **full reskin** even when the user does not use that term:

- asks for "某种风格的皮肤"
- uploads a reference image for inspiration
- asks for a theme based on an art movement, medium, or visual genre
- expects the app to "feel like" the reference rather than merely borrow colors

## 3.1 Minimum effective selector set

If the goal is "paste this CSS and immediately see the theme change", the following selectors are the safest minimum set:

- `.markdown-shadow-body a, [class*='markdown'] a`
- `.markdown-shadow-body code:not(pre code), [class*='markdown'] code:not(pre code)`
- `.markdown-shadow-body pre, [class*='markdown'] pre`
- `.message-item.user .message-bubble`
- `.message-item.ai .message-bubble, .message-item.assistant .message-bubble`

Why this matters:

- Variables alone may not create an obvious visual change
- Image-driven generation often stops at palette translation unless forced into concrete selectors
- Aion users judge success by whether the conversation area visibly changes

If the generated CSS does not touch at least some of these selectors, it is likely too weak for real use.

This selector set should be treated as the default reference scaffold in all theme generation modes.

But it is only the minimum scaffold. It is not sufficient for balanced-theme or full-reskin requests.

## 3.3 Full-reskin must diverge from native

For full-reskin requests, "works but still looks almost native" is not acceptable.

The result should create clear difference in at least these layers:

1. page atmosphere
2. navigation surfaces
3. component styling
4. conversation containers

If the output only changes inline emphasis, links, and bubbles, it failed the full-reskin goal.

## 4. Readability constraints

These are high-risk areas and should be checked explicitly:

- Dark-mode links must be brighter than light-mode links
- Inline chips must have separate text and background tuning for dark mode
- User bubbles should not drift too far from the requested brand family
- Low-saturation themes still need enough text contrast

## 5. Cover versus background

Aion themes can include a preview `cover`. That is not automatically the same thing as a page background.

Be careful:

- A preview cover should usually remain preview-only
- If a cover is present and the user did not ask for a page background, avoid background injection
- Background injection in Aion is controlled via the markers in `backgroundUtils.ts`:
  - `/* AionUi Theme Background Start */`
  - `/* AionUi Theme Background End */`

If you want to prevent automatic cover-to-background behavior for a preset, include an empty background block as a guard.

## 6. Safe default behavior

If the user does not specify otherwise:

- Generate a balanced theme, not an accent-only theme
- Favor semantic consistency over novelty
- Keep the message area clean and readable
- Use inline chips for emphasis instead of heavy `mark` blocks

But if the user is clearly asking for a themed skin, prefer stronger divergence over excessive restraint.

## 6.1 Image-driven mode safety rule

When the user uploads an image and asks for a theme:

- do not output only a palette explanation
- do not output only variables
- do not output a purely decorative concept

Instead, always convert the image tone into:

1. semantic variables
2. markdown/link treatment
3. inline chip treatment
4. assistant and user bubble treatment

That is the minimum needed for the result to feel "effective" inside AionUi.

## 6.2 Non-image modes use the same scaffold

Even when the user provides no image at all, keep the same effective scaffold:

1. semantic variables
2. markdown/link treatment
3. inline chip treatment
4. user and assistant bubble treatment

The difference between modes should be the palette source and visual mood, not whether the CSS is structurally complete.

## 7. Existing preset references

Useful examples in the repo:

- `src/renderer/pages/settings/CssThemeSettings/presets/retroma-y2k.css`
- `src/renderer/pages/settings/CssThemeSettings/presets/retroma-obsidian-book.css`

Study them for:

- variable naming
- light/dark pairing
- message bubble treatment
- inline emphasis behavior
