import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { N8nClient, N8nError } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const testApiKey = process.env.N8N_TEST_API_KEY ?? randomUUID()

function client(fetchImpl: ReturnType<typeof vi.fn>) {
  return new N8nClient({ baseUrl: 'https://n8n.test.invalid', apiKey: testApiKey, fetchImpl })
}

describe('N8nClient', () => {
  it('authenticates with the public API key header without exposing the key in results', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'owner-1', email: 'owner@example.invalid' }))
    const result = await client(fetchImpl).authTest()

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://n8n.test.invalid/api/v1/workflows?limit=1')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['x-n8n-api-key']).toBe(testApiKey)
  })

  it('lists workflows with filters and maps metadata only', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{
        id: 'wf-1',
        name: 'Deploy',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        tags: [{ id: 'tag-1', name: 'production' }],
        nodes: [{ name: 'Trigger' }, { name: 'Deploy' }],
        credentials: { secret: process.env.N8N_TEST_RESPONSE_MARKER ?? randomUUID() },
      }],
      nextCursor: 'cursor-2',
    }))
    const result = await client(fetchImpl).listWorkflows({ limit: 1, cursor: 'cursor-1', active: true, name: 'Deploy' })

    expect(result).toEqual({
      hasMore: true,
      nextCursor: 'cursor-2',
      items: [{ id: 'wf-1', name: 'Deploy', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', tags: ['production'], nodes: 2, url: '' }],
    })
    expect(JSON.stringify(result)).not.toContain('credentials')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/api/v1/workflows?')
    expect(url).toContain('limit=1')
    expect(url).toContain('cursor=cursor-1')
    expect(url).toContain('active=true')
    expect(url).toContain('name=Deploy')
  })

  it('gets workflow details without returning credential or node payloads', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'wf-1', name: 'Deploy', active: false, createdAt: '2026-01-01', updatedAt: '2026-01-02',
      versionId: 'version-1', tags: [{ name: 'production' }], nodes: [{ name: 'Deploy' }], settings: { executionOrder: 'v1' },
      credentials: { token: process.env.N8N_TEST_RESPONSE_MARKER ?? randomUUID() },
      connections: { secret: process.env.N8N_TEST_RESPONSE_MARKER ?? randomUUID() },
    }))
    const result = await client(fetchImpl).getWorkflow('wf-1')

    expect(result).toMatchObject({ id: 'wf-1', name: 'Deploy', active: false, nodes: 1, versionId: 'version-1', settings: { executionOrder: 'v1' } })
    expect(JSON.stringify(result)).not.toContain('credentials')
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('https://n8n.test.invalid/api/v1/workflows/wf-1')
  })

  it('lists workflow versions with cursor pagination and metadata-only mapping', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{
        versionId: 'version-2', workflowId: 'wf-1', authors: 'alice@example.invalid', name: 'Deploy',
        description: 'Production deploy workflow', createdAt: '2026-01-03', updatedAt: '2026-01-04',
        nodes: [{ name: 'Do not expose' }], credentials: { secret: process.env.N8N_TEST_RESPONSE_MARKER ?? randomUUID() },
      }],
      nextCursor: 'history-cursor-2',
    }))
    const result = await client(fetchImpl).listWorkflowVersions('wf-1', { limit: 1, cursor: 'history-cursor-1' })

    expect(result).toEqual({
      hasMore: true,
      nextCursor: 'history-cursor-2',
      items: [{ versionId: 'version-2', workflowId: 'wf-1', authors: 'alice@example.invalid', name: 'Deploy', description: 'Production deploy workflow', createdAt: '2026-01-03', updatedAt: '2026-01-04' }],
    })
    expect(JSON.stringify(result)).not.toContain('credentials')
    expect(JSON.stringify(result)).not.toContain('Do not expose')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://n8n.test.invalid/api/v1/workflows/wf-1/history?limit=1&cursor=history-cursor-1')
  })

  it('gets workflow tag metadata without returning unrelated workflow payloads', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([
      { id: 'tag-1', name: 'production', createdAt: '2026-01-01', updatedAt: '2026-01-02' },
      { id: 'tag-2', name: 'deploy', createdAt: '2026-01-01', updatedAt: '2026-01-02', credentials: { secret: process.env.N8N_TEST_RESPONSE_MARKER ?? randomUUID() } },
    ]))
    const result = await client(fetchImpl).getWorkflowTags('wf-1')

    expect(result).toEqual([
      { id: 'tag-1', name: 'production', createdAt: '2026-01-01', updatedAt: '2026-01-02' },
      { id: 'tag-2', name: 'deploy', createdAt: '2026-01-01', updatedAt: '2026-01-02' },
    ])
    expect(JSON.stringify(result)).not.toContain('credentials')
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('https://n8n.test.invalid/api/v1/workflows/wf-1/tags')
  })

  it('lists and gets execution status without requesting execution data', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'ex-1', workflowId: 'wf-1', mode: 'webhook', status: 'success', startedAt: '2026-01-03', stoppedAt: '2026-01-03', finished: true }], nextCursor: '' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ex-1', workflowId: 'wf-1', mode: 'webhook', status: 'success', startedAt: '2026-01-03', stoppedAt: '2026-01-03', finished: true, data: { resultData: { runData: { secret: process.env.N8N_TEST_RESPONSE_MARKER ?? randomUUID() } } } }))
    const n8n = client(fetchImpl)
    const list = await n8n.listExecutions({ workflowId: 'wf-1', status: 'success' })
    const detail = await n8n.getExecution('ex-1')

    expect(list.items[0]).toMatchObject({ id: 'ex-1', workflowId: 'wf-1', status: 'success', finished: true })
    expect(detail).toMatchObject({ id: 'ex-1', workflowId: 'wf-1', status: 'success' })
    expect(JSON.stringify(detail)).not.toContain('data')
    const [detailUrl] = fetchImpl.mock.calls[1] as [string]
    expect(detailUrl).toContain('/api/v1/executions/ex-1?includeData=false')
  })

  it('stops and retries executions with POST endpoints and maps the new execution', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'ex-1', mode: 'manual', status: 'canceled', startedAt: '2026-10-05T00:00:00.000Z', finished: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ex-9', mode: 'retry', status: 'running', startedAt: '2026-10-05T01:00:00.000Z', retryOf: 'ex-1', workflowId: 'wf-1', finished: false }))
    const n8n = client(fetchImpl)
    const stopped = await n8n.stopExecution('ex-1')
    const retried = await n8n.retryExecution('ex-1', { loadWorkflow: true })

    expect(stopped).toMatchObject({ id: 'ex-1', status: 'canceled', mode: 'manual' })
    expect(retried).toMatchObject({ id: 'ex-9', status: 'running', retryOf: 'ex-1', workflowId: 'wf-1' })
    const [stopUrl, stopInit] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const [retryUrl, retryInit] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(stopUrl).toBe('https://n8n.test.invalid/api/v1/executions/ex-1/stop')
    expect(stopInit.method).toBe('POST')
    expect(stopInit.body).toBeUndefined()
    expect(retryUrl).toBe('https://n8n.test.invalid/api/v1/executions/ex-1/retry')
    expect(retryInit.method).toBe('POST')
    expect(JSON.parse(retryInit.body as string)).toEqual({ loadWorkflow: true })
  })

  it('activates and deactivates one workflow with POST endpoints', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'wf-1', name: 'Deploy', active: true, nodes: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'wf-1', name: 'Deploy', active: false, nodes: [] }))
    const n8n = client(fetchImpl)
    const activated = await n8n.setWorkflowActive('wf-1', true)
    const deactivated = await n8n.setWorkflowActive('wf-1', false)

    expect(activated).toMatchObject({ id: 'wf-1', active: true })
    expect(deactivated).toMatchObject({ id: 'wf-1', active: false })
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe('https://n8n.test.invalid/api/v1/workflows/wf-1/publish')
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].method).toBe('POST')
    expect((fetchImpl.mock.calls[1] as [string, RequestInit])[0]).toBe('https://n8n.test.invalid/api/v1/workflows/wf-1/unpublish')
  })

  it('rejects missing API keys and maps HTTP errors', async () => {
    await expect(new N8nClient({}).authTest()).rejects.toThrow(N8nError)
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'API key is invalid' }, 401))
    await expect(client(fetchImpl).authTest()).rejects.toThrow('API key is invalid')
  })
})

describe('n8n endpoint policy', () => {
  const valid = { apiKey: process.env.N8N_TEST_API_KEY ?? randomUUID() }
  const ok = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  const call = (client: N8nClient) => client.listWorkflows()

  it('rejects literal link-local endpoints by default, including IPv4 embedded in IPv6', async () => {
    for (const baseUrl of [
      'http://169.254.169.254',
      'http://169.254.1.1',
      'http://[fe80::1]',
      'http://[::ffff:169.254.169.254]',
      'http://[64:ff9b::a9fe:a9fe]',
      'http://[::169.254.169.254]',
      'http://0.0.0.0',
      'http://[::]',
    ]) {
      const fetchImpl = vi.fn()
      await expect(call(new N8nClient({ ...valid, baseUrl, fetchImpl }))).rejects.toBeInstanceOf(N8nError)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('keeps the default loopback instance and other self-hosted endpoints working', async () => {
    for (const baseUrl of [
      'http://localhost:5678',
      'http://127.0.0.1:5678',
      'http://10.0.0.5',
      'http://192.168.1.10',
      'http://n8n.internal.corp',
    ]) {
      const fetchImpl = vi.fn(async () => ok())
      await call(new N8nClient({ ...valid, baseUrl, fetchImpl })).catch(() => undefined)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('performs no DNS work in the default mode', async () => {
    const lookupImpl = vi.fn(async () => { throw new Error('default mode must not resolve hostnames') })
    const fetchImpl = vi.fn(async () => ok())
    await call(new N8nClient({ ...valid, baseUrl: 'https://n8n.internal.corp', fetchImpl, lookupImpl })).catch(() => undefined)
    expect(lookupImpl).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects private and link-local endpoints when enforcePublicEndpoint is on', async () => {
    for (const baseUrl of ['http://10.0.0.5', 'http://127.0.0.1', 'http://169.254.169.254', 'http://[fc00::1]']) {
      const fetchImpl = vi.fn()
      await expect(call(new N8nClient({ ...valid, baseUrl, fetchImpl, enforcePublicEndpoint: true }))).rejects.toBeInstanceOf(N8nError)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('resolves and rejects blocked hostnames only when enforcePublicEndpoint is on', async () => {
    const lookupImpl = async () => [{ address: '169.254.169.254', family: 4 as const }]
    const fetchImpl = vi.fn()
    await expect(call(new N8nClient({ ...valid, baseUrl: 'https://metadata.n8n.test', fetchImpl, lookupImpl, enforcePublicEndpoint: true }))).rejects.toBeInstanceOf(N8nError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows a public endpoint when enforcePublicEndpoint is on', async () => {
    const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 as const }]
    const fetchImpl = vi.fn(async () => ok())
    await call(new N8nClient({ ...valid, baseUrl: 'https://n8n.example.test', fetchImpl, lookupImpl, enforcePublicEndpoint: true })).catch(() => undefined)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
