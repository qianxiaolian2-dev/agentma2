# Get structured output from agents (English - no Chinese version available)

> Return validated JSON from agent workflows using JSON Schema, Zod, or Pydantic.

## Quick start

TypeScript:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const schema = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    founded_year: { type: "number" },
    headquarters: { type: "string" }
  },
  required: ["company_name"]
};

for await (const message of query({
  prompt: "Research Anthropic and provide key company information",
  options: { outputFormat: { type: "json_schema", schema: schema } }
})) {
  if (message.type === "result" && message.subtype === "success" && message.structured_output) {
    console.log(message.structured_output);
  }
}
```

Python:
```python
schema = {
    "type": "object",
    "properties": {
        "company_name": {"type": "string"},
        "founded_year": {"type": "number"},
        "headquarters": {"type": "string"},
    },
    "required": ["company_name"],
}

async for message in query(
    prompt="Research Anthropic and provide key company information",
    options=ClaudeAgentOptions(output_format={"type": "json_schema", "schema": schema}),
):
    if isinstance(message, ResultMessage) and message.structured_output:
        print(message.structured_output)
```

## Type-safe schemas with Zod and Pydantic

TypeScript (Zod):
```typescript
import { z } from "zod";

const FeaturePlan = z.object({
  feature_name: z.string(),
  summary: z.string(),
  steps: z.array(z.object({
    step_number: z.number(),
    description: z.string(),
    estimated_complexity: z.enum(["low", "medium", "high"])
  })),
  risks: z.array(z.string())
});

const schema = z.toJSONSchema(FeaturePlan);
```

Python (Pydantic):
```python
from pydantic import BaseModel

class FeaturePlan(BaseModel):
    feature_name: str
    summary: str
    steps: list[Step]
    risks: list[str]

schema = FeaturePlan.model_json_schema()
```

## Output format configuration

- `type`: Set to `"json_schema"` for structured outputs
- `schema`: A JSON Schema object defining your output structure

## Error handling

| Subtype | Meaning |
| --- | --- |
| `success` | Output was generated and validated successfully |
| `error_max_structured_output_retries` | Agent couldn't produce valid output after multiple attempts |
