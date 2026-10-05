# dsh-tool-n8n

[English](README.md) | [中文](README.zh.md)

n8n workflow automation integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) as a Cordis plugin. The agent can inspect workflows, version history, tags, and execution status, and explicitly activate or deactivate one workflow at a time.

## Install

```sh
npm install @libai168/dsh-tool-n8n
```

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies.

## Configuration

```yaml
- name: 'github:LJH-snow/dsh-tool-n8n'
  config:
    baseUrl: 'https://n8n.example.com'
    apiKeyEnv: 'N8N_API_KEY'
    # timeoutMs: 15000
```

The plugin reads the n8n public API key from the environment variable named by `apiKeyEnv` (default: `N8N_API_KEY`). Do not put a usable key in source, examples, tests, or committed configuration. Create the key in n8n under **Settings > n8n API** and grant only the permissions required by the deployment.

`baseUrl` defaults to the local instance at `http://localhost:5678`. The endpoint is checked before every request. Link-local addresses (`169.254.0.0/16`, `fe80::/10`, including their IPv4-compatible, IPv4-mapped, and NAT64 forms) and the unspecified address (`0.0.0.0/8`, `::`) are always rejected: they are never a valid n8n address, and they include the cloud metadata address. Self-hosted instances stay usable by default, including loopback and private networks. Set `enforcePublicEndpoint: true` to additionally require a publicly reachable host; that mode also resolves ordinary hostnames and rejects loopback, private, CGNAT, multicast, reserved, and every IANA special-purpose range.

## Tools

| Tool | Description | Write |
|---|---|---|
| `n8n_auth_test` | Verify the API key without returning it | No |
| `n8n_list_workflows` | List workflows with cursor, active, and name filters | No |
| `n8n_get_workflow` | Read one workflow's metadata and settings summary | No |
| `n8n_list_workflow_versions` | List workflow version-history metadata with cursor pagination | No |
| `n8n_get_workflow_tags` | Read metadata for tags attached to one workflow | No |
| `n8n_list_executions` | List execution status records without execution payload data | No |
| `n8n_get_execution` | Read one execution status record without payload data | No |
| `n8n_activate_workflow` | Publish/activate one workflow | Yes |
| `n8n_deactivate_workflow` | Unpublish/deactivate one workflow | Yes |

## Security contract

- API keys are read from an environment variable at plugin startup and are never included in tool output or rendered text.
- Workflow credentials, node definitions, connections, and execution payload data are intentionally not returned by the client mapping layer.
- Write operations are single-workflow operations and are marked `kind: 'edit'`; there are no bulk, delete, credential, or workflow-definition mutation tools.
- The client passes caller cancellation signals through to `fetch` and uses a 15-second timeout by default.
- API failures are normalized into `{ ok: false, reason }` or `{ found: false, reason }` tool results.

## API scope

This version uses the n8n public API for workflow metadata, version-history metadata, workflow tags, execution inspection, and workflow publish/unpublish (the current API names for activation/deactivation). Version history and tag responses are mapped to metadata only; workflow definitions, nodes, credentials, connections, and execution payloads are not returned. It does not guess at webhook triggering or workflow-definition updates, whose availability and permissions vary by n8n version and deployment. A later version can add an explicit trigger tool after the endpoint contract is verified against supported n8n releases.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## License

[MIT](LICENSE)
