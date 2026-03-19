---
name: aion-css-theme-designer
description: Generate and refine custom AionUi CSS themes from user taste, reference images, or existing presets. Use when the user wants a new Aion theme, asks to adapt a style from screenshots, tune light/dark readability, design inline highlight chips, or convert a visual mood into AionUi theme CSS.
---

# Aion CSS Theme Designer

Generate AionUi-ready CSS themes that are visually coherent, readable in both light and dark mode, and safe to apply inside Aion's theme system.

## When to use this skill

- The user wants a brand new Aion theme from a mood or aesthetic description
- The user provides screenshots or images and wants the theme to follow that color tone
- The user wants to tune an existing preset or merge traits from multiple presets
- The user wants better inline emphasis in chat, especially "small highlighted chips" inside assistant replies
- The user wants preset-ready output, cover-ready output, or both

## Workflow

### 1. Identify the design source

Classify the request into one of these modes:

- **Taste-driven**: the user gives words like "bookish", "retro", "low saturation", "AOU purple-gray"
- **Image-driven**: the user provides one or more images and wants palette extraction
- **Preset-driven**: the user references an existing theme and wants a variant

If images are provided, read [references/image-palette-mapping.md](references/image-palette-mapping.md).

If the request is image-driven, do not only extract colors. Also infer the likely visual style of the image, such as:

- cute / playful
- realistic / photographic
- painterly / oil-like
- futuristic / tech
- editorial / magazine-like
- vintage / retro
- elegant / restrained

That style inference should affect component language, not just palette selection.

Before outputting the final CSS in image-driven mode, explicitly summarize:

1. the extracted palette direction
2. the inferred style tags
3. how those style tags will affect component treatment

Keep that summary short, but do not skip it.

### 1.1 Identify transformation depth

Also classify the request by **transformation depth**:

- **Accent-only**: only small details such as links, chips, markdown, or bubbles should change
- **Balanced theme**: core surfaces and components should change, while layout structure stays familiar
- **Full reskin**: the overall visual language should noticeably change across the app, not just emphasis details

Default rule:

- if the user says "整个皮肤", "整个 css", "整体风格都变", "not just highlights", or expresses dissatisfaction that only small details changed, use **full reskin**
- if the user asks for a subtle refinement, use **accent-only**
- otherwise use **balanced theme**

In practice, most users will not say "full reskin".

So infer **full reskin** automatically when the user:

- asks for "某种风格的皮肤 / theme / skin"
- provides a reference image and expects the UI to feel like that image
- asks for an obvious style transformation rather than a readability tweak
- talks about atmosphere, vibe, temperament, artistic style, material feeling, or visual identity

Do not assume image-driven requests are only about color extraction. Most of them imply a full visual-language change.

## 2. Build the theme in layers

Always generate the theme in this order:

1. Semantic variables in `:root`
2. Semantic variables in `[data-theme='dark']`
3. High-impact component overrides

Do not start by overriding a large number of concrete selectors. Variable design comes first.

Read [references/aion-css-theme-rules.md](references/aion-css-theme-rules.md) before producing final CSS.

### Reference scaffold rule

Treat the previously successful Aion theme structure as a **reference scaffold for all generation modes**, not only image-driven mode.

This applies to:

- taste-driven mode
- image-driven mode
- preset-driven mode
- refinement mode

The scaffold is structural, not stylistic. Reuse the output logic that makes a theme visibly effective inside AionUi, while replacing the palette and mood to fit the current task.

Important:

- the scaffold is a floor, not a ceiling
- do not let the scaffold limit style depth when the user asks for a stronger transformation
- in full reskin mode, expand changes far beyond links, chips, and bubbles

### Required implementation rule

When the user asks for a usable theme, do **not** stop at palette notes or partial snippets.

You must return a **complete AionUi-usable CSS block** with:

1. `:root`
2. `[data-theme='dark']`
3. At least one visible markdown/text treatment
4. At least one visible chat-area treatment

If the output does not include these, it is not complete.

In practice, the minimum visible scaffold should usually include:

- `.markdown-shadow-body a, [class*='markdown'] a`
- `.markdown-shadow-body code:not(pre code), [class*='markdown'] code:not(pre code)`
- `.message-item.user .message-bubble`
- `.message-item.ai .message-bubble, .message-item.assistant .message-bubble`

Without these selectors, image-driven output often looks "correct" in theory but has little or no visible effect in AionUi.

This rule applies to all generation modes, not only image-driven output.

### Full-theme expectation rule

When the inferred intent is "I want a themed skin" rather than "I want a small CSS refinement", do not stay near the native theme.

In that case, the output should visibly change the application's:

- atmosphere
- surfaces
- controls
- navigation
- conversation containers

If the generated result still feels close to the native theme, it is too conservative.

## 3. Handle inline emphasis correctly

Inside Aion conversations, the best-performing emphasis pattern is usually **inline code rendered as a soft chip**, not raw bold text and not heavy `mark` styling.

Read [references/highlight-patterns.md](references/highlight-patterns.md) and prefer the `soft-brand-inline-chip` pattern unless the user explicitly asks for a stronger highlight style.

## 4. Default output constraints

Unless the user explicitly asks otherwise:

- Always generate both light and dark mode
- Keep the theme readable before making it decorative
- Treat theme `cover` as preview-only, not as a full-page background
- Avoid accidental auto-background injection from the cover image
- Keep user message bubbles aligned with the user's preferred AOU tone if requested
- Do not return only abstract palette analysis when the user asked for CSS
- In image-driven mode, always map the image into concrete Aion selectors, not just color variables
- In any mode, prefer an immediately effective theme over a clever but low-impact one
- If the user wants a whole-theme transformation, do not stay in a conservative accent-only zone
- If the user asks for "a skin/theme in some style", assume they want an obvious visual departure from native unless they explicitly ask for subtlety

## 5. Aion-specific implementation targets

When generating or editing theme CSS, prioritize these areas:

- `:root`
- `[data-theme='dark']`
- markdown headings, links, `pre`, inline `code`
- inline emphasis chips inside assistant messages
- `layout-sider`
- `message-item.user .message-bubble`
- `message-item.ai .message-bubble`
- sendbox / input wrappers
- scrollbar and selection

Do not rewrite broad Arco selectors unless the user asks for a heavier restyle.

### 5.1 Expansion targets for balanced/full themes

If the requested depth is **balanced theme** or **full reskin**, go beyond markdown and bubbles. Also consider:

- `body`, `body::before`, `body::after`
- `.app-shell`
- `.chat-layout-header`
- `.layout-content`
- `.layout-sider`
- `.layout-sider-header`
- `.chat-history__item`, `.settings-sider__item`
- `.arco-btn-primary`, `.arco-btn-secondary`, `.arco-btn-outline`
- `.arco-input-wrapper`, `.arco-textarea-wrapper`, `.arco-input-inner-wrapper`
- `.arco-card`, `.arco-modal`, `.arco-dropdown-menu`, `.arco-select-popup`, `.arco-trigger-popup`
- `.guidContainer .guidInputCard`
- `.aion-file-changes-panel`

In full reskin mode, the user should feel that the whole product changed visual language, not only text emphasis.

### 5.2 Native-distance check

Before finalizing a full-theme result, check:

- did header clearly change?
- did sidebar clearly change?
- did buttons clearly change?
- did inputs/sendbox clearly change?
- did cards or modal surfaces clearly change?
- did the message area clearly change?

If most answers are "no", the CSS is still too close to native and should be expanded.

When an image implies a strong visual style, let that style affect component treatment, for example:

- button shape and contrast
- border sharpness versus softness
- shadow weight
- card and bubble texture
- corner radius
- gradient usage
- hover and selected-state personality

## Existing Aion theme files

Use these paths when implementing or studying presets:

- `src/renderer/pages/settings/CssThemeSettings/presets.ts`
- `src/renderer/pages/settings/CssThemeSettings/themeCovers.ts`
- `src/renderer/pages/settings/CssThemeSettings/backgroundUtils.ts`
- `src/renderer/pages/settings/CssThemeSettings/presets/*.css`

## Deliverables

For a generation request, prefer returning:

- A short style summary
- A complete Aion CSS theme
- Notes about readability-sensitive areas: links, inline chips, dark-mode contrast

If the request is balanced theme or full reskin, the CSS should visibly change:

- surfaces
- containers
- controls
- message area
- navigation area

not only inline emphasis details.

If the user is in image-driven mode, the CSS must still be immediately pasteable and visibly effective without extra interpretation.

In image-driven mode, the short style summary should explicitly include:

- palette direction
- 3 to 6 inferred style tags
- 1 short sentence about how those tags changed buttons, bubbles, borders, shadows, or radius

The same standard applies in all other modes: pasteable, visible, and structurally complete.

For a refinement request, prefer returning:

- The modified CSS
- The specific visual behavior changed
- Any remaining risk, such as low contrast or over-strong background texture
