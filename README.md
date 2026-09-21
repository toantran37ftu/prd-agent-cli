# PRD Agent CLI

CLI tool for managing PRDs with AI agents, integrated with Lark.

## Features

- **Sync**: Cache Lark documents locally with incremental updates
- **Review**: AI-powered PRD review with claim verification
- **Ask**: Generate questions for stakeholders based on review findings
- **Draft**: AI-assisted PRD drafting with quality control loop
- **Agent**: Natural language interface via Supervisor agent
- **Memory**: Shared project memory synced to Lark

## Architecture

- **Task-Orchestrator pattern**: Each command has its own orchestrator
- **Critic/Verifier**: Quality control through agent collaboration
- **Scope Guard**: Security boundary for all Lark operations
- **Multi-channel**: Run via builtin, Claude Code, Codex, or generic MCP

## Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Configure
prdcli config set appId <your-app-id>
prdcli config set appSecret <your-app-secret>

# Login
prdcli login

# Select project
prdcli project list
prdcli project use <project-name>
```

## Usage

```bash
# Sync documents
prdcli sync

# Review a document
prdcli review <doc-name>

# Generate questions
prdcli ask <doc-name>

# Draft a PRD
prdcli draft --topic "Feature Name"

# Natural language interface
prdcli agent "Check what's missing in PRD A and draft questions for stakeholders"

# Export for other channels
prdcli export-mcp --channel claude-code
```

## Project Structure

```
prd-agent-cli/
  packages/
    cli/              # CLI application
      src/
        auth/         # OAuth login, token management
        lark/         # Lark API client
        cache/        # Local cache, sync, memory
        runtime/      # Agent runtime implementations
        commands/     # CLI commands
        agents/       # Agent prompts
    tools-mcp/        # MCP server for agent tools
      src/
        scope-guard.ts        # Security boundary
        orchestrators/        # Task orchestrators
        agents/               # Agent implementations
        tools/                # MCP tool definitions
```

## Configuration

Config file: `~/.config/prdcli/config.json`

```json
{
  "appId": "cli_xxx",
  "appSecret": "xxx",
  "region": "larksuite",
  "model": "claude-sonnet-4-6",
  "channel": "builtin"
}
```

## Development

```bash
# Run CLI in dev mode
npm run dev:cli

# Run MCP server in dev mode
npm run dev:mcp

# Build all packages
npm run build
```

## Security

- **Scope Guard**: All operations validated against root folder scope
- **Write Protection**: Write operations restricted to active project
- **Token Security**: Tokens stored with restricted permissions
- **No Secret Logging**: appSecret and tokens never logged
