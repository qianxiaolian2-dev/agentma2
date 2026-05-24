# Observability with OpenTelemetry (English - no Chinese version available)

> Export traces, metrics, and events from the Agent SDK to your observability backend using OpenTelemetry.

## How telemetry flows from the SDK

The Agent SDK runs the Claude Code CLI as a child process. The CLI has OpenTelemetry instrumentation built in. The SDK passes configuration through to the CLI process, and the CLI exports directly to your collector.

Configuration is passed as environment variables:
- **Process environment**: set variables in your shell, container, or orchestrator
- **Per-call options**: set variables in `ClaudeAgentOptions.env` (Python) or `options.env` (TypeScript)

The CLI exports three independent OpenTelemetry signals:

| Signal | What it contains | Enable with |
| --- | --- | --- |
| Metrics | Counters for tokens, cost, sessions, lines of code, and tool decisions | `OTEL_METRICS_EXPORTER` |
| Log events | Structured records for each prompt, API request, API error, and tool result | `OTEL_LOGS_EXPORTER` |
| Traces | Spans for each interaction, model request, tool call, and hook (beta) | `OTEL_TRACES_EXPORTER` plus `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` |

## Enable telemetry export

```python
OTEL_ENV = {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.example.com:4318",
}
```

## Read agent traces

Key spans:
- **`claude_code.interaction`**: wraps a single turn of the agent loop
- **`claude_code.llm_request`**: wraps each call to the Claude API
- **`claude_code.tool`**: wraps each tool invocation
- **`claude_code.hook`**: wraps each hook execution

## Link traces to your application

The SDK automatically propagates W3C trace context into the CLI subprocess. When you call `query()` while an OpenTelemetry span is active, the CLI's span becomes a child of your span.

## Control sensitive data in exports

| Variable | Adds |
| --- | --- |
| `OTEL_LOG_USER_PROMPTS=1` | Prompt text on events |
| `OTEL_LOG_TOOL_DETAILS=1` | Tool input arguments |
| `OTEL_LOG_TOOL_CONTENT=1` | Full tool input and output bodies (requires tracing) |
| `OTEL_LOG_RAW_API_BODIES` | Full API request/response JSON |
