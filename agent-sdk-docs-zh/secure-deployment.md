# Securely deploying AI agents (English - no Chinese version available)

> A guide to securing Claude Code and Agent SDK deployments with isolation, credential management, and network controls

## Threat model

Agents can take unintended actions due to prompt injection or model error. Defense in depth is good practice.

## Built-in security features

- **Permissions system**: Every tool and bash command can be configured to allow, block, or prompt
- **Command parsing for permissions**: Bash commands are parsed into an AST before execution
- **Web search summarization**: Search results are summarized to reduce prompt injection risk
- **Sandbox mode**: Bash commands can run in a sandboxed environment

## Security principles

### Security boundaries
Place sensitive resources outside the boundary containing the agent.

### Least privilege

| Resource | Restriction options |
| --- | --- |
| Filesystem | Mount only needed directories, prefer read-only |
| Network | Restrict to specific endpoints via proxy |
| Credentials | Inject via proxy rather than exposing directly |
| System capabilities | Drop Linux capabilities in containers |

### Defense in depth
Layer multiple controls: container isolation, network restrictions, filesystem controls, request validation at a proxy.

## Isolation technologies

| Technology | Isolation strength | Performance overhead | Complexity |
| --- | --- | --- | --- |
| Sandbox runtime | Good | Very low | Low |
| Containers (Docker) | Setup dependent | Low | Medium |
| gVisor | Excellent | Medium/High | Medium |
| VMs (Firecracker, QEMU) | Excellent | High | Medium/High |

## Credential management

### The proxy pattern
Run a proxy outside the agent's security boundary that injects credentials into outgoing requests.

### Configuring Claude Code to use a proxy

Option 1: `ANTHROPIC_BASE_URL` (for sampling API requests)
```bash
export ANTHROPIC_BASE_URL="http://localhost:8080"
```

Option 2: `HTTP_PROXY` / `HTTPS_PROXY` (system-wide)
```bash
export HTTP_PROXY="http://localhost:8080"
export HTTPS_PROXY="http://localhost:8080"
```

## Filesystem configuration

### Read-only code mounting
```bash
docker run -v /path/to/code:/workspace:ro agent-image
```

### Writable locations
For ephemeral workspaces, use `tmpfs` mounts:
```bash
docker run --read-only --tmpfs /tmp:rw,noexec,nosuid,size=100m --tmpfs /workspace:rw,noexec,size=500m agent-image
```
