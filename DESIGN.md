---
name: JobPilot
description: 'C Focus: white working planes, confident type, focused cobalt and horizontal navigation.'
colors:
  accent: '#1455f3'
  accent-hover: '#0842cb'
  accent-soft: '#eef3ff'
  canvas: '#ffffff'
  surface: '#ffffff'
  ink: '#101116'
  muted: '#596477'
  text-soft: '#647085'
  line: '#d8dfe8'
  line-soft: '#e9edf2'
  field-border: '#b8c2d1'
  surface-muted: '#f2f5f9'
  surface-subtle: '#f7f9fc'
  mint: '#167552'
  mint-soft: '#eaf6ef'
  amber: '#a16d18'
  amber-soft: '#fff2dc'
  red: '#b33c43'
  red-soft: '#fff0f2'
typography:
  headline:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 48px
    fontWeight: 750
    lineHeight: 1.12
    letterSpacing: -.035em
  headline-wide:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 58px
    fontWeight: 750
    lineHeight: 1.12
    letterSpacing: -.035em
  headline-mobile:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 34px
    fontWeight: 750
    lineHeight: 1.15
  title:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 40px
    fontWeight: 750
    lineHeight: 1.18
    letterSpacing: -.035em
  body:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    lineHeight: 1.55
    letterSpacing: '0'
  control:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 12px
    fontWeight: 500
  navigation:
    fontFamily: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 15px
    fontWeight: 500
rounded:
  control: 4px
  field: 3px
  compact: 2px
  plane: '0'
spacing:
  '8': 8px
  '12': 12px
  '16': 16px
  '18': 18px
  '20': 20px
  '22': 22px
  '24': 24px
  '28': 28px
  '36': 36px
  '40': 40px
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    padding: 9px 16px
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    padding: 9px 16px
  button-quiet:
    backgroundColor: transparent
    textColor: '{colors.accent}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    padding: 9px 16px
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: 0 12px
  navigation-active:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.navigation}'
  status-chip:
    typography: '{typography.label}'
    rounded: '{rounded.compact}'
    padding: 4px 8px
  pipeline-card:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.plane}'
    padding: 22px 2px
  score:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
    padding: 15px 8px
    width: 112px
  editor-outline-active:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.accent}'
    padding: 10px 16px
---

# Design System: JobPilot

## Overview

**Creative North Star: "C Focus"**

JobPilot uses white and ice-gray working planes, confident black sans typography, thin dividers, and a focused cobalt accent. A horizontal navigation band anchors the workspace. Content is arranged as readable indexes, open work areas, and explicit actions rather than a collection of floating cards.

This is the C Focus direction. The system supports Chinese and English operational content and adapts its headline scale to laptop and phone widths. The interface chrome and the exported resume or cover-letter paper are separate systems: the saved PDF renderer and export templates retain their existing document styling.

**Key Characteristics:**

- White top navigation with a cobalt active rule; labeled bottom tabs on phones.
- Large, bounded headings and compact utility text.
- Continuous working planes, neutral indexes, and fine structural dividers.
- Cobalt for primary actions and meaningful selection; explicit text for states.

The implementation authority is the import order in `src/app/layout.tsx`: `globals.css`, then `swiss-workspace.css`, then `focus-workspace.css`. Focus is the final composition and token override layer. Swiss still supplies shared field, button, dialog, accessibility, and responsive foundations; its opening sidebar direction comment is historical, not the current composition contract. PRODUCT.md remains product authority. Frontmatter contains the effective reusable values; numeric spacing entries describe observed measurements rather than CSS variable names.

## Colors

Cobalt marks action and selection against white, ice gray, and nearly black type. Names below refer to the frontmatter values.

### Primary

- **Cobalt** (`accent`): primary actions, active rules, selected-row markers, links, and the match-reference block. `accent-hover` darkens primary actions on hover.
- **Pale cobalt** (`accent-soft`): utility hover/active states, quiet actions, and supporting selection feedback.

### Neutral

- **White canvas and surface** (`canvas`, `surface`): the navigation and main working plane.
- **Ice-gray plane** (`surface-muted`): opportunity index, editor outline/preview surroundings, and pipeline lanes. `surface-subtle` is lighter hover and empty-state feedback.
- **Black ink** (`ink`): headings, body copy, and assistant launcher.
- **Slate text** (`muted`, `text-soft`): metadata and placeholders.
- **Structural line**, **soft line**, and **field border** (`line`, `line-soft`, `field-border`): section divisions, internal rules, and stronger editable-field boundaries.

### Semantic states

Green (`mint`, `mint-soft`) communicates positive feedback, amber (`amber`, `amber-soft`) attention or uncertainty, and red (`red`, `red-soft`) errors, destructive actions, and closed states. Existing status variants may have their own foreground values; these are not new brand accents. Keep status labels visible. Tonal ramps in the sidecar are generated panel visualizations, not additional production tokens.

## Typography

The display and body share the system sans stack in the frontmatter. Helvetica Neue and Arial precede PingFang SC and Microsoft YaHei. No interface webfont is loaded. The wordmark is heavy (800); page and selected-role headings are (750). Tabular numerals support scores and counts.

### Hierarchy

- **Headline:** (48px) by default, (58px) from the wide breakpoint, (40px) below the editor-wide breakpoint, and (34px) on phones. The editor masthead uses (42px) on desktop. These are bounded working headings, not a promotional hero.
- **Selected-role title:** the `title` role defaults to (40px), becomes (54px) at wide widths, (32px) below (1180px), and (30px) on phones. Chinese h1/h2 tracking is reset to zero by the language rule.
- **Body:** the `body` role is the base. Evidence uses (14px) with line-height (1.75); descriptions may use up to (76ch). Metadata is commonly (11–13px).
- **Control and label:** standard buttons use the `control` role, navigation the `navigation` role, and status labels the `label` role. Form values are generally (14px), increasing to (16px) on phones.
- **Score:** a local reference, (48px) by default, (58px) on wide screens, (40px) below (1180px), and (36px) on phones. Its qualifier remains visible.

Document typography belongs to the existing PDF/export implementation. The bundled NotoSansCJKsc font used in document generation is not the interface font.

## Layout

The desktop header is sticky and (78px) tall. From (761–999px), it uses a two-row (120px) header: brand/utilities above primary links. At (760px) and below, the top bar is (64px), and four labeled primary tabs form a fixed bottom bar of (70px) plus the safe-area inset. The main area reserves bottom space; utilities and secondary destinations remain reachable through the top bar and More menu. There is no sidebar or collapsed icon rail.

The working shell has a maximum width of (1720px), with (36px 40px 64px) padding. Below (1180px), padding is (30px 28px 56px); phones use (26px 20px 44px), plus the main content's bottom navigation reservation. The activation route retains its (1320px) width limit. Spacing is contextual, using the observed intervals in the frontmatter.

Discovery is a surface-specific asymmetric composition. At (1000px) and above, a roughly (30/70) index/detail grid uses `minmax(300px, .3fr) minmax(0, .7fr)`. The ice-gray index is a vertical list; the white detail plane is sticky below navigation and contains a title/score header, two evidence columns, source line, and action footer. The masthead aligns title, target, and actions on wide screens. At (999px) and below, list and detail become separate views; entering a role scrolls to the top and focuses its title. Returning scrolls the originating row into view and restores focus. On phones evidence stacks and its action footer sits above the bottom navigation.

The saved-resume editor uses three independently scrollable columns at (1180px) and above: (164px) module navigation, `minmax(380px, 1.1fr)` fields, and `minmax(340px, 1fr)` saved PDF pane. Its height is `max(560px, calc(100dvh - 275px))`. New resumes have no saved preview. Below that breakpoint, the full preview remains a dedicated route; from (761–1179px), outline and fields stay side by side. On phones module navigation becomes a horizontal strip above fields. Toolbars remain sticky and their actions fit the available width.

Pipeline uses a horizontal flex board with (22px) gaps, occupied lanes with a (252px) flex basis, and compact (156px) empty lanes. The local stage index provides direct access to lanes. Phone lanes use `min(280px, calc(100vw - 60px))`, with (18px) gaps. Resume lists, settings, forms, and interview sections use open rows and dividers. Wide tables retain contained horizontal scrolling.

## Elevation & Depth

Working planes stay flat. Fine rules, white/ice-gray contrast, and spacing distinguish adjacent regions. The selected opportunity and selected editor module use an inset cobalt rule; it signals state rather than elevation. Buttons do not lift on hover.

### Shadow Vocabulary

- **More menu:** `0 18px 48px rgb(16 17 22 / 16%)`, over a backdrop of `rgb(16 17 22 / 18%)`.
- **Transient overlays:** the existing `--shadow-soft` token, `0 14px 40px rgb(23 29 43 / 14%)`, for shared dialog/popover surfaces.
- **Assistant launcher:** `0 4px 16px rgb(23 29 43 / 16%)`.

Paper shadows inside document rendering remain separate from working-plane depth.

## Shapes

Buttons, score blocks, and menus use the `control` corner radius; fields retain `field`; small badges use `compact`. The working plane, list rows, editor sections, and pipeline entries use square edges. Structural dividers are generally (1px); the desktop active navigation rule is (4px), and selected list/module markers are (3px). The phone active tab rule is (3px). Icons remain line SVGs, with a cobalt arrow beside the black wordmark. No raster illustrations ship with this direction; approved comps and screenshots are review evidence.

## Components

### Buttons

Primary buttons use cobalt with white text; secondary buttons use white, ink, and a structural border; quiet buttons use cobalt text and a transparent border/background. Shared destructive controls keep semantic red. Standard buttons have a minimum height of (44px); discovery row actions explicitly remain (36px), and some phone toolbar actions use (42px). Apply the actual contextual sizing rather than a universal height assumption. Disabled controls use the unavailable cursor and shared reduced opacity.

Color and border transitions use (160ms) `ease`, without hover movement. The general keyboard focus outline is (2px) cobalt, offset (3px). Field focus uses its stronger border treatment. Reduced-motion preferences reduce transition/animation duration to (0.01ms) and disable automatic smooth scrolling.

### Inputs and fields

White editable fields keep visible labels, dark text, the stronger field border, and (12px) horizontal padding in the canonical job form. Typical form fields are at least (44px) high, with contextual compact controls retained. Focus changes the border to cobalt; placeholders use soft slate. Textareas resize where the existing form supports it. Error and success messages retain explicit text and semantic surfaces.

### Navigation and menus

Primary navigation combines visible text, a weight change, and the active rule. Desktop icons are hidden; phone tabs show icons and labels. Utility hover and active states use pale cobalt. More opens a white overlay containing secondary destinations and account/language controls, with focus containment, Escape dismissal, backdrop dismissal, and focus return to its trigger. The skip link and accessible names remain present.

### Chips and filters

Status and source badges are small near-square rectangles. Labels remain readable without interpreting color. Ordinary segmented controls keep a muted track and white active segment. Discovery's filters instead use an open tab row with an inset cobalt active underline; they are local index controls, not another global navigation system.

### Opportunity index and decision plane

Rows combine company, role, location, reference score or pending state, source, deadline, and status. Selection is white with a cobalt left rule. The row action disclosure exposes existing actions without filling each row with primary buttons. The selected role's reference block is cobalt; pending analysis uses a neutral block. Evidence and uncertainty remain beside guidance and source attribution. The ignore action is quiet and separated from the main application action. Preserve all filters and pagination.

### Pipeline entries and resume rows

Pipeline entries sit directly in ice-gray lanes, separated by bottom rules, with title, metadata, next action, status control, and edit/remove actions. Empty lanes are narrower and keep compact explanatory text. Resume rows use a document-shaped neutral icon region, title/details, and wrapping actions rather than enclosing each row in a raised card.

The optional application overview sits between the page header and the board/list toolbar. It starts collapsed and expands inline into a white SVG Sankey with muted status-colored bands, dark counts, and fine section dividers. Count saved application records, including those not yet applied. Summarize effective stage paths: erase loops caused by returning to an earlier status, keep missing-history and long-path folding explicit, and never infer unrecorded stages. Original events remain unchanged in the application timeline. Omit an initial To apply visit after a record has advanced; records still there retain a To apply branch. Share common path prefixes and use one node for both records stopping at a stage and records continuing through it. Its total includes both groups; a small Still here count identifies records remaining there, and outgoing bands represent only those continuing. Do not split stages into Past and Current nodes. Reserve separate vertical corridors after each branch, including room for records stopping at an internal node. Distinct histories may retain separate same-name outcomes; the text legend aggregates current counts. Keep labels above a protected straight connector segment or beside a terminal node, outside the bands. Display the diagram at its natural readable size without stretching short paths to fill the desktop. On phones the chart scrolls within its own focusable region and the legend becomes a single column; the page itself must not overflow. SVG download uses the same diagram and does not call AI or external services.

### Resume modules and PDF preview

The active outline item uses white and a cobalt edge; phone selection uses a bottom rule. Fields remain semantic editable controls in divided sections. The adjacent PDF is explicitly **saved version preview**, with a reminder to save edits and a full-preview link. It renders through the existing saved PDF endpoint; unsaved draft edits are not a live PDF preview. Export templates are unchanged.

### Dialogs and working feedback

Shared native dialogs contain scrolling and restore focus after dismissal. Assistant, notifications, loading, errors, and onboarding remain transient feedback around the workspace. The phone assistant launcher sits in the top utility region; the assistant panel clears bottom navigation. Preserve truthful loading, pending, and failure labels.

## Do's and Don'ts

### Do:

- **Do** preserve the approved horizontal navigation and labeled phone tabs.
- **Do** use the effective Focus tokens and check the complete stylesheet cascade before extending a surface.
- **Do** keep source, uncertainty, guidance, and status text beside match evidence.
- **Do** retain explicit focus, menu/dialog dismissal, return focus, and reduced-motion behavior.
- **Do** contain wide boards, tables, and editor panes within their own scrolling regions.
- **Do** label the editor PDF as saved content and keep exported document templates independent of interface styling.

### Don't:

- **Don't** restore the blue sidebar or horizontal opportunity strip from the superseded composition.
- **Don't** turn continuous work areas into a stack of rounded, shadowed cards.
- **Don't** use color alone to communicate navigation, status, or selection.
- **Don't** copy synthetic comp content, source claims, or demo scores into production data.
- **Don't** describe the saved PDF pane as a live preview of unsaved edits.
- **Don't** impose the discovery index/detail layout on every route.
