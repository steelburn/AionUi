# Image Palette Mapping

When the user provides one or more reference images, do not copy colors mechanically. Extract the mood, then map it into Aion theme semantics.

## 0. Extract both palette and style

Do not stop at color extraction.

From the image, infer two layers:

1. **Palette signals**
- dominant color
- secondary color
- neutral light
- neutral dark
- accent color

2. **Style signals**
- cute / soft / toy-like
- realistic / photographic
- painterly / oil / textured
- futuristic / sci-fi / tech
- minimal / editorial
- vintage / retro / nostalgic
- luxury / elegant / restrained

The palette should shape the colors.
The style signals should shape the component language.

## 1. Extract these palette roles

From the image, identify:

- dominant brand color
- secondary support color
- warm or cool neutral light
- warm or cool neutral dark
- one accent color for links or emphasis

## 1.1 Extract style adjectives

After palette roles, summarize the image into 3 to 6 style adjectives.

Examples:

- `cute, pastel, soft, rounded, playful`
- `realistic, moody, cinematic, restrained`
- `retro, nostalgic, dusty, editorial`
- `futuristic, luminous, glassy, sharp`
- `oil-painted, textured, warm, handcrafted`

This summary should be shown to the user before or alongside the final CSS, so the inferred direction is inspectable instead of hidden.

## 2. Map image roles to Aion variables

Recommended mapping:

- dominant brand color -> `--brand`
- primary action color -> `--color-primary`
- light neutral -> `--bg-base`, `--bg-1`
- dark neutral -> dark mode `--bg-base`, `--bg-1`
- text neutral -> `--text-primary`, `--text-secondary`
- emphasis accent -> links or chips, only after contrast adjustment

## 3. Do not directly reuse extracted colors for these areas

These should be adjusted instead of copied:

- dark-mode link color
- inline chip text color
- inline chip background color
- border colors
- user bubble fill

Raw image colors often look good in isolation but fail in dense UI text contexts.

## 4. Contrast correction rules

After palette extraction:

- lighten dark-mode links if they look muted against dark backgrounds
- reduce saturation for large surfaces
- keep saturation slightly higher for small chips and action elements
- ensure body text remains more neutral than brand accents

## 5. Preserve user intent over literal sampling

If the user asks for:

- "bookish" -> warm neutrals, restrained accents, low saturation
- "tech" -> cleaner contrast, cooler primaries, sharper borders
- "AOU purple-gray" -> keep user bubbles and emphasis close to muted purple-gray rather than following the image exactly

## 5.1 Map style to component language

The inferred style should change component treatment as well:

- **Cute / playful**
  - rounder corners
  - softer borders
  - gentler chips
  - friendlier bubble shapes
- **Realistic / photographic**
  - flatter surfaces
  - more restrained gradients
  - lower saturation on large areas
  - subtler accents
- **Painterly / oil-like**
  - warmer surfaces
  - slightly organic softness
  - reduced mechanical sharpness
- **Futuristic / tech**
  - cleaner contrast
  - sharper edges
  - more luminous links and highlights
  - tighter border definition
- **Editorial / magazine-like**
  - more restrained decoration
  - stronger typography hierarchy
  - cleaner spacing rhythm

## 6. Inline emphasis after image mapping

For image-driven themes, inline emphasis chips should still use the `soft-brand-inline-chip` pattern from `highlight-patterns.md`.

Do not turn chips into mini color swatches copied directly from the image.

## 7. Deliverable expectation

For image-driven theme work, the final output should mention both:

- the extracted palette direction
- the inferred style direction

The resulting CSS should reflect both color and component-language changes.

Recommended compact format:

- Palette: `muted lavender + sage + warm cream`
- Style tags: `soft, cute, rounded, nostalgic`
- Component effect: `use softer borders, rounder buttons, lighter shadows, and friendlier chat bubbles`
