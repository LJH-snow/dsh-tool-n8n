import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { N8nClient, N8nError } from './client.js'

export const name = 'dsh-tool-n8n'
export const inject = ['tools']

export interface N8nPluginConfig {
  baseUrl?: string
  /** Environment variable containing the n8n public API key. */
  apiKeyEnv?: string
  timeoutMs?: number
}

export function apply(ctx: Context, config: N8nPluginConfig = {}) {
  const apiKeyEnv = config.apiKeyEnv ?? 'N8N_API_KEY'
  const client = new N8nClient({
    baseUrl: config.baseUrl,
    apiKey: process.env[apiKeyEnv],
    timeoutMs: config.timeoutMs,
  })
  for (const tool of createTools(client)) ctx.tools.register(tool)
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }]
}

function unavailable(reason: string) {
  return { found: false, items: [], hasMore: false, nextCursor: '', reason }
}

function errorReason(error: unknown): string {
  return error instanceof N8nError ? error.message : error instanceof Error ? error.message : String(error)
}

function renderWorkflows(items: Array<{ id?: string; name?: string; active?: boolean; nodes?: number; tags?: string[]; updatedAt?: string }>) {
  if (!items.length) return text('No n8n workflows found.')
  return text(items.map(workflow => `${workflow.name ?? ''} (${workflow.id ?? ''}) active=${workflow.active ? 'yes' : 'no'} nodes=${workflow.nodes ?? 0} tags=${workflow.tags?.join(', ') ?? ''} updated=${workflow.updatedAt ?? ''}`).join('\n'))
}

function renderWorkflow(value: { id?: string; name?: string; active?: boolean; nodes?: number; tags?: string[]; createdAt?: string; updatedAt?: string; versionId?: string; url?: string }) {
  return text([
    `${value.name ?? ''} (${value.id ?? ''})`,
    `active=${value.active ? 'yes' : 'no'} nodes=${value.nodes ?? 0} tags=${value.tags?.join(', ') ?? ''}`,
    `created=${value.createdAt ?? ''} updated=${value.updatedAt ?? ''} version=${value.versionId ?? ''}`,
    value.url ? `url=${value.url}` : '',
  ].filter(Boolean).join('\n'))
}

function renderWorkflowVersions(items: Array<{ versionId?: string; workflowId?: string; authors?: string; name?: string; description?: string; createdAt?: string; updatedAt?: string }>) {
  if (!items.length) return text('No n8n workflow versions found.')
  return text(items.map(version => [
    `${version.versionId ?? ''} workflow=${version.workflowId ?? ''} name=${version.name ?? ''}`,
    `authors=${version.authors ?? ''} created=${version.createdAt ?? ''} updated=${version.updatedAt ?? ''}`,
    version.description ? `description=${version.description.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n')).join('\n'))
}

function renderWorkflowTags(items: Array<{ id?: string; name?: string; createdAt?: string; updatedAt?: string }>) {
  if (!items.length) return text('No n8n workflow tags found.')
  return text(items.map(tag => `${tag.name ?? ''} (${tag.id ?? ''}) created=${tag.createdAt ?? ''} updated=${tag.updatedAt ?? ''}`).join('\n'))
}

function renderExecutions(items: Array<{ id?: string; workflowId?: string; workflowName?: string; status?: string; mode?: string; startedAt?: string; stoppedAt?: string; finished?: boolean }>) {
  if (!items.length) return text('No n8n executions found.')
  return text(items.map(execution => `${execution.id ?? ''} workflow=${execution.workflowName || execution.workflowId || ''} status=${execution.status ?? ''} mode=${execution.mode ?? ''} finished=${execution.finished ? 'yes' : 'no'} started=${execution.startedAt ?? ''} stopped=${execution.stoppedAt ?? ''}`).join('\n'))
}

function renderExecution(value: { id?: string; workflowId?: string; workflowName?: string; status?: string; mode?: string; startedAt?: string; stoppedAt?: string; retryOf?: string; finished?: boolean }) {
  return text([
    `execution=${value.id ?? ''} workflow=${value.workflowName || value.workflowId || ''}`,
    `status=${value.status ?? ''} mode=${value.mode ?? ''} finished=${value.finished ? 'yes' : 'no'}`,
    `started=${value.startedAt ?? ''} stopped=${value.stoppedAt ?? ''}`,
    value.retryOf ? `retryOf=${value.retryOf}` : '',
  ].filter(Boolean).join('\n'))
}

function renderWrite(value: { ok?: boolean; reason?: string; id?: string; name?: string; active?: boolean }) {
  return value.ok
    ? text(`Workflow ${value.name ?? value.id ?? ''} active=${value.active ? 'yes' : 'no'}`)
    : text(`n8n workflow update failed: ${value.reason ?? ''}`)
}

export function createTools(client: N8nClient) {
  return [
    defineTool({
      name: 'n8n_auth_test',
      description: 'Verify the configured n8n public API key without returning the key.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, baseUrl: { type: 'string' } } },
        render: (_args, value) => value.ok ? text(`n8n API authentication succeeded at ${value.baseUrl ?? ''}.`) : text(`n8n authentication failed: ${value.reason ?? ''}`),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'Verify n8n credentials', kind: 'read' } },
      async execute(_args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'n8n API key is not configured.' }
        try {
          await client.authTest(exec.signal)
          return { ok: true, baseUrl: client.getBaseUrl() }
        } catch (error) { return { ok: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_list_workflows',
      description: 'List n8n workflows with cursor pagination and optional active/name filters.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 50)' },
        cursor: { type: 'string', description: 'Cursor returned by a previous response' },
        active: { type: 'boolean', description: 'Filter to active or inactive workflows' },
        name: { type: 'string', description: 'Filter by workflow name' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' }, nodes: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }, url: { type: 'string' } } } }, hasMore: { type: 'boolean' }, nextCursor: { type: 'string' },
        } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'n8n is not configured.') : renderWorkflows(value.items ?? []),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'n8n workflows', kind: 'search' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('n8n API key is not configured.')
        try { return { found: true, ...await client.listWorkflows({ limit: args.limit as number, cursor: args.cursor as string, active: args.active as boolean, name: args.name as string, signal: exec.signal }) } }
        catch (error) { return unavailable(errorReason(error)) }
      },
    }),

    defineTool({
      name: 'n8n_get_workflow',
      description: 'Get one n8n workflow metadata record without returning credential values or execution data.',
      parameters: { workflowId: { type: 'string', required: true, description: 'n8n workflow ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' }, nodes: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }, versionId: { type: 'string' }, url: { type: 'string' } } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'n8n workflow not found.') : renderWorkflow(value),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `n8n workflow ${args.workflowId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { found: false, reason: 'n8n API key is not configured.' }
        if (!args.workflowId) return { found: false, reason: 'workflowId is required.' }
        try { return { found: true, ...await client.getWorkflow(args.workflowId as string, exec.signal) } }
        catch (error) { return { found: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_list_workflow_versions',
      description: 'List metadata for one n8n workflow version history with cursor pagination. Workflow definitions, nodes, and credentials are never returned.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'n8n workflow ID' },
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 50)' },
        cursor: { type: 'string', description: 'Cursor returned by a previous response' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { versionId: { type: 'string' }, workflowId: { type: 'string' }, authors: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } } } }, hasMore: { type: 'boolean' }, nextCursor: { type: 'string' },
        } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'n8n workflow history unavailable.') : renderWorkflowVersions(value.items ?? []),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `n8n workflow history ${args.workflowId ?? ''}`, kind: 'search' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('n8n API key is not configured.')
        if (!args.workflowId) return unavailable('workflowId is required.')
        try { return { found: true, ...await client.listWorkflowVersions(args.workflowId as string, { limit: args.limit as number, cursor: args.cursor as string, signal: exec.signal }) } }
        catch (error) { return unavailable(errorReason(error)) }
      },
    }),

    defineTool({
      name: 'n8n_get_workflow_tags',
      description: 'Get safe metadata for the tags attached to one n8n workflow without returning workflow definitions or credentials.',
      parameters: { workflowId: { type: 'string', required: true, description: 'n8n workflow ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } } } },
        } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'n8n workflow tags unavailable.') : renderWorkflowTags(value.items ?? []),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `n8n workflow tags ${args.workflowId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { found: false, items: [], reason: 'n8n API key is not configured.' }
        if (!args.workflowId) return { found: false, items: [], reason: 'workflowId is required.' }
        try { return { found: true, items: await client.getWorkflowTags(args.workflowId as string, exec.signal) } }
        catch (error) { return { found: false, items: [], reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_list_executions',
      description: 'List n8n workflow executions with cursor, workflow, and status filters. Execution payload data is never returned.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 50)' },
        cursor: { type: 'string', description: 'Cursor returned by a previous response' },
        workflowId: { type: 'string', description: 'Filter by workflow ID' },
        status: { type: 'string', description: 'Execution status such as success, error, or waiting' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, workflowId: { type: 'string' }, workflowName: { type: 'string' }, status: { type: 'string' }, mode: { type: 'string' }, startedAt: { type: 'string' }, stoppedAt: { type: 'string' }, finished: { type: 'boolean' } } } }, hasMore: { type: 'boolean' }, nextCursor: { type: 'string' },
        } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'n8n executions unavailable.') : renderExecutions(value.items ?? []),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'n8n executions', kind: 'search' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('n8n API key is not configured.')
        try { return { found: true, ...await client.listExecutions({ limit: args.limit as number, cursor: args.cursor as string, workflowId: args.workflowId as string, status: args.status as string, signal: exec.signal }) } }
        catch (error) { return unavailable(errorReason(error)) }
      },
    }),

    defineTool({
      name: 'n8n_get_execution',
      description: 'Get one n8n execution status record without returning execution payload data.',
      parameters: { executionId: { type: 'string', required: true, description: 'n8n execution ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, workflowId: { type: 'string' }, workflowName: { type: 'string' }, status: { type: 'string' }, mode: { type: 'string' }, startedAt: { type: 'string' }, stoppedAt: { type: 'string' }, retryOf: { type: 'string' }, finished: { type: 'boolean' } } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'n8n execution not found.') : renderExecution(value),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `n8n execution ${args.executionId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { found: false, reason: 'n8n API key is not configured.' }
        if (!args.executionId) return { found: false, reason: 'executionId is required.' }
        try { return { found: true, ...await client.getExecution(args.executionId as string, false, exec.signal) } }
        catch (error) { return { found: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_stop_execution',
      description: 'Stop one running n8n execution. WRITE operation; single-execution only.',
      parameters: { executionId: { type: 'string', required: true, description: 'n8n execution ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, status: { type: 'string' }, mode: { type: 'string' }, startedAt: { type: 'string' }, stoppedAt: { type: 'string' } } },
        render: (_args, value) => value.ok ? text(`Execution ${value.id ?? ''} status=${value.status ?? ''} mode=${value.mode ?? ''}`) : text(`n8n execution stop failed: ${value.reason ?? ''}`),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Stop n8n execution ${args.executionId ?? ''}`, kind: 'edit' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'n8n API key is not configured.' }
        if (!args.executionId) return { ok: false, reason: 'executionId is required.' }
        try { return { ok: true, ...await client.stopExecution(args.executionId as string, exec.signal) } }
        catch (error) { return { ok: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_retry_execution',
      description: 'Retry one n8n execution and report the new execution it started. WRITE operation; single-execution only.',
      parameters: {
        executionId: { type: 'string', required: true, description: 'n8n execution ID to retry' },
        loadWorkflow: { type: 'boolean', description: 'Retry with the currently saved workflow version instead of the one saved at execution time' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, status: { type: 'string' }, mode: { type: 'string' }, retryOf: { type: 'string' }, workflowId: { type: 'string' }, startedAt: { type: 'string' } } },
        render: (_args, value) => value.ok ? text(`Retry started: new execution ${value.id ?? ''} status=${value.status ?? ''} retryOf=${value.retryOf ?? ''}${value.workflowId ? ` workflow=${value.workflowId}` : ''}`) : text(`n8n execution retry failed: ${value.reason ?? ''}`),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Retry n8n execution ${args.executionId ?? ''}`, kind: 'edit' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'n8n API key is not configured.' }
        if (!args.executionId) return { ok: false, reason: 'executionId is required.' }
        try {
          return { ok: true, ...await client.retryExecution(args.executionId as string, { loadWorkflow: args.loadWorkflow as boolean, signal: exec.signal }) }
        } catch (error) { return { ok: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_activate_workflow',
      description: 'Activate one n8n workflow. WRITE operation; single-workflow only.',
      parameters: { workflowId: { type: 'string', required: true, description: 'n8n workflow ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' } } },
        render: (_args, value) => renderWrite(value),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Activate n8n workflow ${args.workflowId ?? ''}`, kind: 'edit' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'n8n API key is not configured.' }
        if (!args.workflowId) return { ok: false, reason: 'workflowId is required.' }
        try { return { ok: true, ...await client.setWorkflowActive(args.workflowId as string, true, exec.signal) } }
        catch (error) { return { ok: false, reason: errorReason(error) } }
      },
    }),

    defineTool({
      name: 'n8n_deactivate_workflow',
      description: 'Deactivate one n8n workflow. WRITE operation; single-workflow only.',
      parameters: { workflowId: { type: 'string', required: true, description: 'n8n workflow ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' } } },
        render: (_args, value) => renderWrite(value),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Deactivate n8n workflow ${args.workflowId ?? ''}`, kind: 'edit' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'n8n API key is not configured.' }
        if (!args.workflowId) return { ok: false, reason: 'workflowId is required.' }
        try { return { ok: true, ...await client.setWorkflowActive(args.workflowId as string, false, exec.signal) } }
        catch (error) { return { ok: false, reason: errorReason(error) } }
      },
    }),
  ]
}
