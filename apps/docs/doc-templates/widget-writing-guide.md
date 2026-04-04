# Widget Documentation Writing Guide

Each widget doc page should follow this structure. Read the widget's source code thoroughly before writing.

## Template Structure

```mdx
---
title: "{{Widget Name}}"
description: "{{One line from DashboardWidgetDefinition.description}}"
---

import { Callout } from 'fumadocs-ui/components/callout'

## Overview

| Property | Value |
|----------|-------|
| **Key** | `{{widget_key}}` |
| **Category** | {{Editor / List / Utility / Data}} |

{{2-3 sentences explaining what this widget does and when to use it.}}

## Features

{{Bullet list of key capabilities. Read the actual component code to find real features — don't guess.}}

## Usage

{{How to use this widget. Include:}}
- How to add it to a workspace
- Key interactions (what clicking/typing does)
- Any keyboard shortcuts
- How it pairs with other widgets (pairColor mechanism)

## Configuration

{{If the widget has settings or configuration options, document them here.}}

## Related

{{Links to related docs — feature guides, other widgets that pair with this one.}}
```

## Key Rules

1. **Read the source code** — don't write generic boilerplate. Each widget is different.
2. **No images** — describe interactions in text.
3. **For editor widgets** — mention that the corresponding List widget provides browsing/creating, but the editor is the main doc page.
4. **For pairColor widgets** — explain which widgets sync together.
5. **Keep it concise** — 50-100 lines per page.
