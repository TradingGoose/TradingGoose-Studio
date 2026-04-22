---
version: alpha
name: TradingGoose Studio
description: >
  A dual-theme design system for a trading workstation product family with a
  crisp marketing shell, a dense multi-panel workspace, and a quieter
  documentation skin. The system is built around neutral surfaces, a single
  gold accent, restrained shadows, and subtle animated grid backgrounds.
colors:
  primary: "#FFCC00"
  primary-foreground: "#0C0A09"
  primary-soft: "#FFE066"
  primary-strong: "#FFD633"
  background-light: "#FFFFFF"
  background-dark: "#080706"
  foreground-light: "#0C0A09"
  foreground-dark: "#FAFAF9"
  surface-light: "#FEFEFE"
  surface-dark: "#0C0A09"
  surface-raised-light: "#FDFDFD"
  surface-raised-dark: "#171717"
  surface-muted-light: "#EFEFF0"
  surface-muted-dark: "#27272A"
  surface-accent-light: "#F8F8F9"
  surface-accent-dark: "#212123"
  surface-secondary-light: "#E7E7E9"
  surface-secondary-dark: "#242429"
  popover-light: "#FFFFFF"
  popover-dark: "#0D0D0D"
  text-muted-light: "#71717B"
  text-muted-dark: "#9F9FA9"
  sidebar-light: "#FAFAFA"
  sidebar-dark: "#18181B"
  sidebar-accent-light: "#F4F4F5"
  sidebar-accent-dark: "#27272A"
strokes:
  border-light: "#E4E4E7"
  border-dark: "#262626"
  input-light: "#C9C9CF"
  input-dark: "#404040"
signals:
  grid-light: "#F1F1F1"
  grid-dark: "#131313"
  chart-positive: "#10B981"
  chart-negative: "#EF4444"
  chart-neutral: "#3B82F6"
  info: "#2563EB"
  success: "#16A34A"
  warning: "#D97706"
  destructive-light: "#E7000B"
  destructive-dark: "#FF6467"
typography:
  display-xl:
    fontFamily: Soehne
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Soehne
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: 540
    lineHeight: 1.15
    letterSpacing: -0.03em
  title-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 540
    lineHeight: 32px
    letterSpacing: -0.02em
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 460
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 460
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 460
    lineHeight: 16px
  label-eyebrow:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 460
    lineHeight: 16px
    letterSpacing: 0.24em
  code-md:
    fontFamily: Geist Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  code-sm:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
rounded:
  xxs: 0.5px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  "2xl": 16px
  "3xl": 24px
  full: 9999px
spacing:
  "0": 0px
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  "2xl": 32px
  "3xl": 48px
  "4xl": 64px
  "5xl": 96px
  "6xl": 128px
  workspace-header-height: 48px
  control-height: 40px
  sidebar-width: 224px
  sidebar-width-mobile: 288px
  docs-sidebar-width: 286px
  chat-composer-max-width: 748px
  marketing-max-width: 1280px
  marketing-grid-cell: 56px
  canvas-zoom-control: 40px
shadows:
  none: "none"
  sm: "0 1px 2px 0 #0000000D"
  md: "0 4px 12px -2px #00000014"
  lg: "0 12px 24px -6px #0000001A"
  xl: "0 20px 40px -12px #00000026"
  "2xl": "0 25px 50px -12px #00000040"
elevation:
  flat:
    borderColor: "{strokes.border-light}"
    shadow: "{shadows.none}"
  subtle:
    borderColor: "{strokes.border-light}"
    shadow: "{shadows.sm}"
  card:
    borderColor: "{strokes.border-light}"
    shadow: "{shadows.md}"
  popover:
    borderColor: "{strokes.border-light}"
    shadow: "{shadows.lg}"
  modal:
    borderColor: "{strokes.border-light}"
    shadow: "{shadows.xl}"
motion:
  duration-fast: "150ms"
  duration-base: "200ms"
  duration-medium: "300ms"
  duration-slow: "500ms"
  duration-loop-fast: "1500ms"
  duration-loop-medium: "2500ms"
  easing-standard: "cubic-bezier(0.4, 0, 0.2, 1)"
  easing-soft: "ease-out"
  easing-smooth: "ease-in-out"
  hover-glow-radius: 40px
  overlay-blur: 1.5px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-soft}"
  button-primary-active:
    backgroundColor: "{colors.primary-strong}"
  button-secondary-light:
    backgroundColor: "{colors.surface-secondary-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 16px"
  button-secondary-dark:
    backgroundColor: "{colors.surface-secondary-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 16px"
  pill-light:
    backgroundColor: "{colors.surface-secondary-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  pill-dark:
    backgroundColor: "{colors.surface-secondary-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  input-light:
    backgroundColor: "{colors.background-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 12px"
  input-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 12px"
  workspace-panel-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.foreground-light}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  workspace-panel-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  workspace-panel-raised-light:
    backgroundColor: "{colors.surface-raised-light}"
    textColor: "{colors.foreground-light}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  workspace-panel-raised-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  workspace-panel-muted-light:
    backgroundColor: "{colors.surface-muted-light}"
    textColor: "{colors.foreground-light}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  workspace-panel-muted-dark:
    backgroundColor: "{colors.surface-muted-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  workspace-tab-light:
    backgroundColor: "{colors.surface-accent-light}"
    textColor: "{colors.text-muted-light}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 12px"
  workspace-tab-active-light:
    backgroundColor: "{colors.background-light}"
    textColor: "{colors.foreground-light}"
  workspace-tab-dark:
    backgroundColor: "{colors.surface-accent-dark}"
    textColor: "{colors.text-muted-dark}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: "0 12px"
  workspace-tab-active-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.foreground-dark}"
  chat-composer-light:
    backgroundColor: "{colors.background-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.body-md}"
    rounded: "{rounded.3xl}"
    padding: "{spacing.lg}"
  chat-composer-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.3xl}"
    padding: "{spacing.lg}"
  popover-surface-light:
    backgroundColor: "{colors.popover-light}"
    textColor: "{colors.foreground-light}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  popover-surface-dark:
    backgroundColor: "{colors.popover-dark}"
    textColor: "{colors.foreground-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  sidebar-shell-light:
    backgroundColor: "{colors.sidebar-light}"
    textColor: "{colors.foreground-light}"
    padding: "{spacing.lg}"
  sidebar-shell-dark:
    backgroundColor: "{colors.sidebar-dark}"
    textColor: "{colors.foreground-dark}"
    padding: "{spacing.lg}"
  sidebar-item-active-light:
    backgroundColor: "{colors.sidebar-accent-light}"
    textColor: "{colors.foreground-light}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  sidebar-item-active-dark:
    backgroundColor: "{colors.sidebar-accent-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  code-panel-light:
    backgroundColor: "{colors.foreground-light}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.code-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  code-panel-dark:
    backgroundColor: "{colors.background-dark}"
    textColor: "{colors.foreground-dark}"
    typography: "{typography.code-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
---

## Overview
TradingGoose Studio should feel like a clean, instrument-grade trading workstation rather than a lifestyle dashboard. The product is neutral, sharp, and information-dense, with a single warm gold accent used to indicate the main action or the currently active tool. The overall impression is disciplined and quiet: white or near-black canvases, hairline borders, compact controls, and dense panel groupings.

The marketing and public surfaces use the same visual language, but with more breathing room and more atmosphere. They introduce faint animated grids, ripple fields, and node-and-beam diagrams to suggest workflows, signals, and automation. The effect should feel technical and precise, not playful. The docs experience is the quietest member of the family: it keeps the same gold accent and neutral chrome, but removes most of the theatrical background treatment.

## Colors
The palette is built from neutrals first and brand color second.

- **Gold (`#FFCC00`)** is the single signature accent. Use it for the primary call to action, the selected utility action, the highlighted logo frame, and loading strokes. It is intentionally warmer and louder than the rest of the interface.
- **Light mode** is almost paper-white. Core backgrounds are true white or near-white, with subtle stacking between `background-light`, `surface-light`, `surface-raised-light`, and `surface-muted-light`.
- **Dark mode** is almost black rather than blue-black. Surfaces step from `background-dark` through `surface-dark`, `surface-raised-dark`, `surface-muted-dark`, and `surface-secondary-dark`. Dark mode should preserve the same gold accent rather than changing brand temperature.
- **Borders** are low-contrast separators, not hard frames. In both themes the system prefers tonal layering and line work over loud fills.
- **Data colors** such as `chart-positive`, `chart-negative`, `chart-neutral`, `info`, `success`, and `warning` are semantic overlays. They belong in charts, notices, and workflow state, not in brand framing.
- **Grid colors** stay faint. The animated landing grid and workspace dots should read as structure in the background, never as texture competing with content.

## Typography
Typography uses two voices.

- **Soehne** handles branded or editorial moments: public navigation, auth and changelog headlines, and other moments that need more personality. It should feel compact, confident, and slightly premium.
- **Inter** is the default product voice. It carries almost all working UI: tabs, buttons, table text, chat copy, forms, badges, and dashboard headings. It should feel precise and contemporary, not decorative.
- **Geist Mono** or an equivalent crisp monospace is reserved for code, structured data, and technical previews. Code should feel clean and legible rather than retro-terminal.
- The hierarchy is intentionally compressed. Dense screens lean heavily on 14px to 16px body sizes, 12px labels, and 11px uppercase eyebrows with generous tracking. Large type is used sparingly and mainly on marketing, auth, and empty-state surfaces.

## Layout
There are three layout modes inside the same system.

- **Marketing pages** use wide centered containers, generous vertical spacing, and large open fields around the hero and feature sections. Animated grids and connection lines may occupy entire sections behind the content.
- **Workspace screens** are edge-to-edge and tool-like. The shell uses a compact 48px top header, a narrow icon-first sidebar, resizable panel groups, tab rails, and nested cards. The composition should privilege density, scanning speed, and side-by-side comparison.
- **Docs** sit between the two: more spacious than the workspace, less dramatic than marketing, with a dedicated left navigation rail and restrained card treatment.

Spacing follows a pragmatic 4px and 8px rhythm. Internal control padding is small and efficient; card padding usually lands at 16px or 24px. Headers, sidebars, tab bars, and chat composers should align to the same grid so even busy screens still read as orderly.

## Elevation & Depth
Depth is subtle. The system prefers tonal stacking, borders, and selective shadows over heavy floating layers.

- Most panels are separated by a border plus a soft shadow.
- Popovers, dropdowns, and dialogs step up in shadow strength, but they should still feel crisp and controlled rather than soft and glassy.
- Dark mode relies more on tonal contrast than on large drop shadows. A near-black panel on a slightly lighter near-black field is often enough.
- Marketing cards use localized hover glows and background ripples to create energy without changing the base system. These effects should feel like technical instrumentation, not liquid glass.

## Shapes
The default shape language is rectangular with softened corners.

- **4px to 8px radii** are the baseline for dense controls, tabs, cells, and compact panels.
- **12px to 16px radii** are for cards, dropdowns, overlays, and medium-size containers.
- **24px and full pill radii** are reserved for hero chips, oversized chat composers, badge pills, and a few high-visibility marketing elements.

Avoid mixing extremely sharp corners with overly bubbly ones inside the same view. The system should feel consistent, compact, and deliberate.

## Components
Core component behavior should follow these patterns:

- **Primary buttons** are gold with dark text. They are compact, slightly weighty, and visually obvious.
- **Secondary and outline actions** are neutral surfaces with strong text, relying on borders, fill shifts, and shadow rather than secondary brand colors.
- **Tabs** switch state through tonal inversion: the active tab usually becomes the clearest surface while inactive tabs recede into muted backgrounds.
- **Panels and cards** are neutral containers with crisp borders and restrained shadow. In the workspace they should feel like functional modules, not promotional tiles.
- **Sidebar items** read as compact utility controls. The gold accent belongs to the workspace identity tile and the strongest current action, not every row.
- **Hero chips and small badges** use pill geometry and quiet neutral fills. They support the main message; they should not overpower it.
- **Chat composers** are oversized relative to other controls, with deep rounding and a more conversational silhouette than the rest of the workspace.
- **Code panels** should be the darkest surfaces in the system, with bright, legible syntax colors and strong contrast against surrounding chrome.

## Do's and Don'ts
- Do use gold only for the primary action, active utility emphasis, and brand-defining highlights.
- Do keep most of the interface neutral so charts, workflows, and semantic states have room to stand out.
- Do preserve dense alignment and tight rhythm in the workspace, even when adding new panels or controls.
- Do let marketing pages breathe more than product screens, but keep them visually related through the same colors, radii, and type voices.
- Do keep animated grids, ripples, and node connections subtle and structural.
- Don't turn neutral surfaces into colorful cards.
- Don't replace borders with heavy shadow everywhere.
- Don't use glassmorphism, saturated gradients, or whimsical illustration styles.
- Don't make dark mode blue, neon, or glossy; it should remain charcoal, restrained, and high-contrast.
