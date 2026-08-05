# Design System Strategy: The Digital Sommelier

## 1. Overview & Creative North Star
The Creative North Star for this system is **"The Digital Sommelier."** This concept blends the high-precision logic of AI-driven logistics with the refined, tactile prestige of the spirits industry. 

To move beyond the "SaaS template" look, this system rejects rigid, boxed-in grids. Instead, it utilizes **Editorial Asymmetry**—where large, authoritative typography is paired with airy, breathable negative space and overlapping "glass" layers. This creates an interface that feels less like a database and more like a high-end digital concierge. We achieve this through depth, tonal shifts rather than lines, and a deliberate contrast between "Tech" (Cyan) and "Craft" (Gold).

## 2. Colors & Atmospheric Depth
Our palette is rooted in a deep, midnight foundation, designed to mimic the atmosphere of a premium lounge while maintaining the legibility required for enterprise inventory management.

### The Foundation
- **Background (`#0f131f`):** The base canvas.
- **Surface Tiers:** We define depth through nesting, not borders.
    - `surface_container_lowest` (#0a0e1a): Use for background-level deep structural areas.
    - `surface_container_low` (#171b28): Standard content sectioning.
    - `surface_container` (#1b1f2c): Primary card surfaces.
    - `surface_container_highest` (#313442): Raised interactive elements.

### The Accents
- **Primary (`#c3f5ff` / `#00e5ff`):** The "Intelligence" layer. Use for data visualizations, AI-driven insights, and primary actions.
- **Secondary (`#e9c176`):** The "Hospitality" layer. Use for premium highlights, high-value inventory markers, and brand flourishes.

### Critical Visual Rules
*   **The "No-Line" Rule:** 1px solid borders for sectioning are strictly prohibited. Boundaries must be defined solely through background color shifts (e.g., a `surface_container` card sitting on a `surface_container_low` background).
*   **The Glass & Gradient Rule:** Floating panels or navigation bars should use `surface_bright` with a 60% opacity and a `20px` backdrop-blur. For main CTAs, use a subtle linear gradient from `primary` to `primary_container` at a 135-degree angle to provide visual "soul."

## 3. Typography: The Editorial Voice
We use a dual-typeface system to balance technical precision with premium aesthetics.

*   **Display & Headlines (Manrope):** Chosen for its geometric modernism. Use `display-lg` and `headline-lg` with tight letter-spacing (-0.02em) to create an authoritative, "magazine-cover" feel.
*   **Body & Labels (Inter):** The workhorse for data. Inter provides maximum legibility at small scales (e.g., `label-sm`) for complex inventory lists.
*   **Hierarchy Strategy:** Use `tertiary_fixed` (Gold) for high-level labels to create a "Signature" look, while keeping `on_surface_variant` for secondary data to maintain visual quiet.

## 4. Elevation & Tonal Layering
Traditional drop shadows are often too "heavy" for a sleek dark mode. We utilize **Ambient Tonalism**.

*   **The Layering Principle:** Stack containers to create natural lift. Place a `surface_container_highest` element on a `surface_container` background to indicate interactivity without using a single shadow.
*   **Ambient Shadows:** When an element must "float" (e.g., a modal), use a wide-spread shadow (`blur: 40px`) at 8% opacity, using the `primary` color as the shadow tint rather than black. This mimics the glow of a high-tech screen.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke, use `outline_variant` at **15% opacity**. It should be felt, not seen.

## 5. Components & Primitives

### Buttons
*   **Primary:** A gradient fill from `primary` to `primary_container`. Text in `on_primary`. Corner radius: `md` (0.375rem).
*   **Secondary:** A "Glass" button. `surface_container_highest` background with 40% opacity and a `0.5px` ghost border. 
*   **Tertiary:** No background. `secondary` (Gold) text with an underline that only appears on hover.

### Input Fields
*   **Style:** Background set to `surface_container_lowest`. No border. A `2px` bottom-only accent in `primary` appears only when the field is focused. 
*   **Error State:** Use `error` text and a soft `error_container` outer glow.

### Cards & Inventory Lists
*   **No Dividers:** Forbid the use of horizontal lines between list items. Use `2.5rem` (Spacing 10) of vertical whitespace to separate entries. 
*   **Active State:** Use a subtle `primary` glow on the left edge (3px width) to indicate a selected inventory item.

### Specialized Components
*   **Inventory Pulse:** A small, pulsing glow using `secondary` (Gold) to highlight "Low Stock" items, mimicking a light reflecting off a bottle.
*   **Glass Drawer:** Side navigation should be a full-height `backdrop-blur` panel that slides over the content, maintaining the sense of depth.

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical layouts (e.g., a large `display-md` headline offset to the left with a data visualization floating to the right).
*   **Do** use `16` (4rem) spacing for major section transitions to allow the "Premium" vibe to breathe.
*   **Do** apply glassmorphism to any element that sits "above" the main flow (modals, tooltips, floating headers).

### Don't
*   **Don’t** use pure black (#000000). Always use the `surface` tokens to maintain the midnight navy depth.
*   **Don’t** use standard "Success Green." Use `primary` (Cyan) for positive states to stay within the tech-forward brand identity.
*   **Don’t** cram data. If a screen feels busy, increase the spacing tokens by one level across the board. Precision requires clarity.