# Design System Strategy: Editorial Clarity

## 1. Overview & Creative North Star

### Creative North Star: "The Modern Curator"
This design system moves away from the cluttered, utility-first aesthetics of traditional property management. Our North Star is **The Modern Curator**—an approach that treats community data with the same reverence as a high-end editorial magazine. 

By leveraging intentional asymmetry, expansive negative space (breathing room), and a "made clearer" philosophy, we transform complex logistics into a serene digital environment. We break the "standard template" look by using exaggerated typographic scales and overlapping surfaces that suggest depth without the clutter of traditional lines.

---

## 2. Colors

The palette is anchored in deep, authoritative blues (`primary: #05213a`) and sophisticated botanical teals (`tertiary: #002520`). This creates a sense of institutional trust while feeling fresh and contemporary.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off content. Traditional borders create visual noise. Instead, boundaries must be defined solely through:
- **Background Color Shifts:** A `surface-container-low` section sitting on a `surface` background.
- **Tonal Transitions:** Using the `surface-variant` to gently distinguish a header from a body.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of premium materials. Use the `surface-container` tiers (Lowest to Highest) to create "nested" depth.
- **Base:** `surface` (#f9faf7)
- **Primary Content Area:** `surface-container-low` (#f3f4f2)
- **Elevated Cards:** `surface-container-lowest` (#ffffff) — This creates a "lifted" feel through pure color value.

### The "Glass & Gradient" Rule
To elevate the experience beyond flat UI:
- **Glassmorphism:** Use semi-transparent `surface` colors with `backdrop-blur` (e.g., 20px) for floating navigation bars or mobile overlays.
- **Signature Gradients:** For high-impact CTAs, use a subtle linear gradient from `primary` (#05213a) to `primary-container` (#1e3750). This adds a "soul" to the interface that flat colors cannot replicate.

---

## 3. Typography

The typographic system utilizes a high-contrast pairing: **Manrope** for authoritative, editorial expression and **Inter** for clinical, legible utility.

- **Display & Headlines (Manrope):** These are the "Editorial" voice. Use `display-lg` (3.5rem) with tight letter-spacing (-0.02em) to create a bold, "made clearer" statement. 
- **Titles & Body (Inter):** This is the "Utility" voice. `body-lg` (1rem) provides a comfortable reading experience for complex bylaws or billing statements.
- **Labeling:** Use `label-md` in all-caps with a slight tracking increase (+0.05em) for category headers to provide a premium, metadata-driven look.

---

## 4. Elevation & Depth

We eschew traditional "drop shadows" in favor of **Tonal Layering**.

### The Layering Principle
Depth is achieved by stacking tiers. For instance, a resident's billing card (`surface-container-lowest`) placed on top of a dashboard background (`surface-container`) creates a soft, natural lift without any artificial shadows.

### Ambient Shadows
If an element *must* float (e.g., a critical modal or FAB):
- **Blur:** 32px to 64px.
- **Opacity:** 4% to 8%.
- **Tint:** The shadow color should not be black, but a tinted version of `on-surface` (#191c1b) to mimic natural ambient light.

### The "Ghost Border" Fallback
If accessibility requires a container edge, use a **Ghost Border**: `outline-variant` at 15% opacity. Never use 100% opaque borders.

---

## 5. Components

### Buttons
- **Primary:** High-contrast `primary` background with `on-primary` text. Use `rounded-lg` (0.5rem) for a modern, approachable feel.
- **Secondary:** `secondary-container` background. No border.
- **Tertiary:** Pure text using `primary` color, strictly for low-priority actions.

### Cards & Lists
**Rule:** Forbid the use of divider lines. 
- **Separation:** Use `spacing-6` (2rem) of vertical white space or a background shift to `surface-container-high` to distinguish between list items.
- **Context:** In "Dwell Hub," a list of maintenance requests should look like a series of clean blocks, not a spreadsheet.

### Inputs & Form Fields
- **Background:** `surface-container-highest`.
- **States:** On focus, transition the background to `surface-container-lowest` and apply a "Ghost Border" of `primary` at 20%.
- **Roundedness:** Maintain `md` (0.375rem) for a professional, crisp edge.

### Resident Status Chips
- Use `tertiary-container` for "Paid" or "Active" states. The deep teal suggests growth and stability.
- Use `error-container` with `on-error-container` for "Overdue" notices, ensuring high legibility.

---

## 6. Do's and Don'ts

### Do
- **Do** use asymmetrical layouts. Place a large `display-md` headline on the left with a `body-lg` paragraph offset to the right to create an editorial feel.
- **Do** lean into white space. If a screen feels "empty," it is likely working.
- **Do** use `primary-fixed` for subtle highlights in dark-mode or high-emphasis areas.

### Don't
- **Don't** use 1px solid black or grey borders. 
- **Don't** use standard Material Design "Drop Shadows." They feel dated and "out-of-the-box."
- **Don't** crowd the interface. Each piece of information (Maintenance Due, Society Notices) needs its own "plot of land" on the screen.
- **Don't** use pure black (#000000). Always use `on-surface` (#191c1b) for text to maintain a premium, soft-ink look.