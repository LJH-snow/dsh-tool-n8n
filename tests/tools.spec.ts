import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { N8nClient } from '../src/client.ts'
import { createTools } from '../src/index.ts'

const clientForTest = () => new N8nClient({ apiKey: process.env.N8N_TEST_API_KEY ?? randomUUID() })

describe('dsh-tool-n8n tools', () => {
  it('registers the n8n tool set', () => {
    expect(createTools(clientForTest()).map(tool => tool.name)).toEqual([
      'n8n_auth_test',
      'n8n_list_workflows',
      'n8n_get_workflow',
      'n8n_list_workflow_versions',
      'n8n_get_workflow_tags',
      'n8n_list_executions',
      'n8n_get_execution',
      'n8n_activate_workflow',
      'n8n_deactivate_workflow',
    ])
  })

  it('renders workflow and execution results without payload data', () => {
    const tools = createTools(clientForTest())
    const workflows = tools.find(item => item.name === 'n8n_list_workflows')!
    const workflowView = workflows.output.render({}, {
      found: true,
      items: [{ id: 'wf-1', name: 'Deploy', active: true, nodes: 4, tags: ['production'], updatedAt: '2026-01-02' }],
    }) as Array<{ text: string }>
    expect(workflowView[0].text).toContain('Deploy (wf-1) active=yes nodes=4 tags=production')

    const versions = tools.find(item => item.name === 'n8n_list_workflow_versions')!
    const versionView = versions.output.render({}, {
      found: true,
      items: [{ versionId: 'version-2', workflowId: 'wf-1', authors: 'alice@example.invalid', name: 'Deploy', description: 'Production deploy workflow' }],
    }) as Array<{ text: string }>
    expect(versionView[0].text).toContain('version-2 workflow=wf-1 name=Deploy')
    expect(versionView[0].text).toContain('description=Production deploy workflow')

    const tags = tools.find(item => item.name === 'n8n_get_workflow_tags')!
    const tagView = tags.output.render({}, {
      found: true,
      items: [{ id: 'tag-1', name: 'production', createdAt: '2026-01-01', updatedAt: '2026-01-02' }],
    }) as Array<{ text: string }>
    expect(tagView[0].text).toContain('production (tag-1) created=2026-01-01 updated=2026-01-02')

    const executions = tools.find(item => item.name === 'n8n_get_execution')! 
    const executionView = executions.output.render({}, {
      found: true,
      id: 'ex-1',
      workflowId: 'wf-1',
      workflowName: 'Deploy',
      status: 'success',
      mode: 'webhook',
      finished: true,
    }) as Array<{ text: string }>
    expect(executionView[0].text).toContain('execution=ex-1 workflow=Deploy')
    expect(executionView[0].text).toContain('status=success mode=webhook finished=yes')
  })

  it('marks workflow activation and deactivation as edits', () => {
    const tools = createTools(clientForTest())
    const activate = tools.find(item => item.name === 'n8n_activate_workflow')!
    const deactivate = tools.find(item => item.name === 'n8n_deactivate_workflow')!
    expect(activate.presentCall({ workflowId: 'wf-1' })).toMatchObject({ kind: 'edit' })
    expect(deactivate.presentCall({ workflowId: 'wf-1' })).toMatchObject({ kind: 'edit' })
    const view = activate.output.render({}, { ok: true, id: 'wf-1', name: 'Deploy', active: true }) as Array<{ text: string }>
    expect(view[0].text).toContain('Workflow Deploy active=yes')
  })
})
