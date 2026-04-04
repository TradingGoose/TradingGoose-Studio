# Documentation Templates

Standards and templates for writing documentation pages in TradingGoose docs.
Each template defines the expected structure, required sections, and available components for its category.

> **Location**: `apps/docs/doc-templates/` — co-located with the docs app for easy reference.
> **Audit**: Run `bun run docs:audit` from the repo root to check coverage.

## Categories

| Template | Output Path | Content Type |
|----------|-------------|--------------|
| `block.mdx` | `content/docs/en/blocks/{slug}.mdx` | Built-in workflow blocks (Agent, Condition, Loop, etc.) |
| `tool.mdx` | `content/docs/en/tools/{slug}.mdx` | Integration tools (Slack, GitHub, trading blocks, etc.) |
| `indicator.mdx` | `content/docs/en/indicators/{slug}.mdx` | PineTS scripting guide pages |
| `widget.mdx` | `content/docs/en/widgets/{slug}.mdx` | Dashboard UI components |
| `trigger.mdx` | `content/docs/en/triggers/{slug}.mdx` | Workflow trigger types |
| `utility.mdx` | `content/docs/en/mcp/`, `skills/`, `custom-tools/` | MCP, Skills, Custom Tools |

## Available MDX Components

These can be imported and used in any doc page:

### From fumadocs-ui
- `Callout` — info/warning/error callout boxes
- `Step, Steps` — numbered step-by-step instructions
- `Tab, Tabs` — tabbed content sections
- `Accordion, Accordions` — collapsible sections
- `Card, Cards` — card grid layouts

### From @/components/ui
- `ShowcaseCard` — **primary visual wrapper**. Ripple grid background card for displaying any content (previews, images, mock components). Use this instead of bare images.
- `BlockConfigPreview` — renders a block's config panel from JSON `subBlocks`. No screenshot needed — just copy the subBlocks array from the block's `.ts` source.
- `TriggerDeployPreview` — renders a trigger deploy modal from JSON fields.
- `BlockInfoCard` — colored icon card header for tool/block pages.
- `Image` — optimized image with lightbox (`src` relative to `/public/static/`).
- `Video` — video player (`src` relative to `/public/static/`).
- `CodeBlock` — syntax-highlighted code block.

## Visual Standards

### Prefer JSON rendering over screenshots

Instead of taking screenshots (which need dark/light mode variants and go stale), render block configs from JSON:

```mdx
import { BlockConfigPreview } from '@/components/ui/block-config-preview'
import { ShowcaseCard } from '@/components/ui/showcase-card'

<ShowcaseCard caption="Slack block configuration">
  <BlockConfigPreview
    name="Slack"
    type="slack"
    color="#611f69"
    subBlocks={[
      { "id": "operation", "title": "Operation", "type": "dropdown",
        "options": [{ "label": "Send Message", "id": "send" }] },
      { "id": "channel", "title": "Channel", "type": "short-input",
        "placeholder": "#general" }
    ]}
  />
</ShowcaseCard>
```

### How to extract subBlocks JSON

1. Open the block source: `apps/tradinggoose/blocks/blocks/{slug}.ts`
2. Find the `subBlocks` array
3. Copy the fields, keeping only serializable props: `id`, `title`, `type`, `layout`, `placeholder`, `description`, `defaultValue`, `options`, `required`, `password`, `min`, `max`, `step`, `language`, `provider`
4. Strip: functions (`value()`, `condition()`, `fetchOptions()`), React components (`icon`), store references

### ShowcaseCard for all visuals

Wrap **any** visual content (JSON previews, images, videos, mock components) in `ShowcaseCard`:

```mdx
{/* JSON-rendered block — no screenshot */}
<ShowcaseCard caption="Block config">
  <BlockConfigPreview ... />
</ShowcaseCard>

{/* Image when screenshot is truly needed */}
<ShowcaseCard caption="Dashboard view">
  <Image src="/static/widgets/dashboard.png" alt="Dashboard" width={600} height={400} />
</ShowcaseCard>

{/* Custom grid size */}
<ShowcaseCard rows={8} cols={16} cellSize={48}>
  <TriggerDeployPreview ... />
</ShowcaseCard>
```

## Other Conventions

1. **Frontmatter**: Always include `title` and `description`
2. **Meta.json**: Each category directory needs a `meta.json` listing page order
3. **Manual content markers**: Use `{/* MANUAL-CONTENT-START:sectionName */}` / `{/* MANUAL-CONTENT-END */}` to protect hand-written sections from the generator
4. **Code language**: Use `javascript` for PineTS code blocks (not `pinescript` — Shiki doesn't support it)
5. **No emojis**: Unless explicitly requested

## How to Use

1. Copy the relevant `.mdx` template
2. Replace all `{{PLACEHOLDER}}` values with actual content
3. Remove sections marked `{/* OPTIONAL */}` that don't apply
4. Run `bun run docs:audit` from repo root to verify coverage
