---
name: dashboard-generator
description: Generate editable dashboard configurations from uploaded datasets or a KPI brief for AgentMa dashboard-studio workflows. Use when building or updating the project’s dashboard generation flow, dataset-driven analysis pages, editable chart layouts, or configuration-first BI prototypes inside agentma2.
---

# Dashboard Generator

## Goal

Turn a dataset or KPI brief into an editable dashboard config, not a fixed mock page.

## Rules

- Prefer real datasource fields over guessed labels.
- Separate `analysis`, `layout`, `charts`, and `filters`.
- Keep the first version small: 1 overview page, 2-4 components, 1 drill table.
- Make chart type swappable.
- Never hardcode a single metric if the dataset can supply fields.

## Workflow

1. Inspect the uploaded datasource.
2. Infer time, dimension, metric, and risk fields.
3. Pick a chart type per question.
4. Emit a configuration object the UI can edit.
5. Keep a fallback path for metric-only inputs.

## Output Shape

Prefer JSON with:

- `title`
- `business`
- `datasourceId`
- `fields`
- `components`
- `filters`
- `notes`

## Editing Support

When the user asks to change a chart:

- Preserve the underlying field mapping.
- Only change the component config.
- Recompute preview data from the same datasource.

