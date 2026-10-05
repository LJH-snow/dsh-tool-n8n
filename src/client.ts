/** n8n public REST API client with injected fetch for testability. */

export interface N8nClientOptions {
  /** n8n instance URL, for example https://n8n.example.com. */
  baseUrl?: string
  /** n8n public API key. Prefer supplying it from a secret-backed config. */
  apiKey?: string
  /** Request timeout in milliseconds. 0 disables the timeout. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class N8nError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'N8nError'
  }
}

export interface N8nWorkflowInfo {
  id: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
  tags: string[]
  nodes: number
  url: string
}

export interface N8nWorkflowDetail extends N8nWorkflowInfo {
  settings: Record<string, unknown>
  versionId: string
}

export interface N8nWorkflowVersionInfo {
  versionId: string
  workflowId: string
  authors: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface N8nWorkflowTagInfo {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface N8nExecutionInfo {
  id: string
  workflowId: string
  workflowName: string
  status: string
  mode: string
  startedAt: string
  stoppedAt: string
  retryOf: string
  retrySuccessId: string
  waitTill: string
  finished: boolean
}

export interface N8nPage<T> {
  items: T[]
  nextCursor: string
  hasMore: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapTags(value: unknown): string[] {
  return asArray(value).map(item => {
    const tag = asRecord(item)
    return asString(tag, 'name') || asString(tag, 'id')
  }).filter(Boolean)
}

function mapWorkflow(value: unknown): N8nWorkflowInfo {
  const record = asRecord(value)
  const nodes = asArray(record.nodes)
  return {
    id: asString(record, 'id'),
    name: asString(record, 'name'),
    active: asBoolean(record, 'active'),
    createdAt: asString(record, 'createdAt'),
    updatedAt: asString(record, 'updatedAt'),
    tags: mapTags(record.tags),
    nodes: nodes.length,
    url: asString(record, 'url'),
  }
}

function mapWorkflowDetail(value: unknown): N8nWorkflowDetail {
  const record = asRecord(value)
  return {
    ...mapWorkflow(value),
    settings: asRecord(record.settings),
    versionId: asString(record, 'versionId'),
  }
}

function mapWorkflowVersion(value: unknown): N8nWorkflowVersionInfo {
  const record = asRecord(value)
  return {
    versionId: asString(record, 'versionId'),
    workflowId: asString(record, 'workflowId'),
    authors: asString(record, 'authors'),
    name: asString(record, 'name'),
    description: asString(record, 'description'),
    createdAt: asString(record, 'createdAt'),
    updatedAt: asString(record, 'updatedAt'),
  }
}

function mapWorkflowTag(value: unknown): N8nWorkflowTagInfo {
  const record = asRecord(value)
  return {
    id: asString(record, 'id'),
    name: asString(record, 'name'),
    createdAt: asString(record, 'createdAt'),
    updatedAt: asString(record, 'updatedAt'),
  }
}

function mapExecution(value: unknown): N8nExecutionInfo {
  const record = asRecord(value)
  const workflowData = asRecord(record.workflowData)
  const workflow = asRecord(record.workflow)
  return {
    id: asString(record, 'id'),
    workflowId: asString(record, 'workflowId') || asString(workflow, 'id'),
    workflowName: asString(workflowData, 'name') || asString(workflow, 'name'),
    status: asString(record, 'status'),
    mode: asString(record, 'mode'),
    startedAt: asString(record, 'startedAt'),
    stoppedAt: asString(record, 'stoppedAt'),
    retryOf: asString(record, 'retryOf'),
    retrySuccessId: asString(record, 'retrySuccessId'),
    waitTill: asString(record, 'waitTill'),
    finished: asBoolean(record, 'finished'),
  }
}

function responseItems<T>(value: unknown, key: string, mapper: (item: unknown) => T): T[] {
  const record = asRecord(value)
  return asArray(record[key]).map(mapper)
}

function responseNextCursor(value: unknown): string {
  return asString(asRecord(value), 'nextCursor')
}

function encode(value: string): string {
  return encodeURIComponent(value)
}

export class N8nClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: N8nClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:5678').replace(/\/+$/, '').replace(/\/api\/v1$/, '')
    this.apiKey = options.apiKey ?? ''
    this.timeoutMs = options.timeoutMs ?? 15000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey)
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    options: { params?: Record<string, string | number | boolean | undefined>; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (!this.hasCredentials()) throw new N8nError('n8n API key not configured.', 401)
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-n8n-api-key': this.apiKey,
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const controller = new AbortController()
    const combined = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    const timer = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined
    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: combined,
      })
      const raw = await response.text()
      let json: unknown = {}
      if (raw) {
        try { json = JSON.parse(raw) } catch { json = {} }
      }
      if (!response.ok) {
        const record = asRecord(json)
        const message = asString(record, 'message') || asString(record, 'error') || raw.slice(0, 300) || response.statusText
        throw new N8nError(`n8n API ${method} ${path} returned HTTP ${response.status}: ${message}`, response.status)
      }
      return json as T
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async authTest(signal?: AbortSignal): Promise<{ ok: boolean }> {
    await this.request('GET', '/api/v1/workflows', { params: { limit: 1 }, signal })
    return { ok: true }
  }

  async listWorkflows(options: { limit?: number; cursor?: string; active?: boolean; name?: string; signal?: AbortSignal } = {}): Promise<N8nPage<N8nWorkflowInfo>> {
    const raw = await this.request('GET', '/api/v1/workflows', {
      params: { limit: options.limit ?? 50, cursor: options.cursor, active: options.active, name: options.name },
      signal: options.signal,
    })
    return { items: responseItems(raw, 'data', mapWorkflow), nextCursor: responseNextCursor(raw), hasMore: Boolean(responseNextCursor(raw)) }
  }

  async getWorkflow(workflowId: string, signal?: AbortSignal): Promise<N8nWorkflowDetail> {
    const raw = await this.request('GET', `/api/v1/workflows/${encode(workflowId)}`, { signal })
    return mapWorkflowDetail(raw)
  }

  async listExecutions(options: { limit?: number; cursor?: string; workflowId?: string; status?: string; includeData?: boolean; signal?: AbortSignal } = {}): Promise<N8nPage<N8nExecutionInfo>> {
    const raw = await this.request('GET', '/api/v1/executions', {
      params: { limit: options.limit ?? 50, cursor: options.cursor, workflowId: options.workflowId, status: options.status, includeData: options.includeData },
      signal: options.signal,
    })
    return { items: responseItems(raw, 'data', mapExecution), nextCursor: responseNextCursor(raw), hasMore: Boolean(responseNextCursor(raw)) }
  }

  async listWorkflowVersions(workflowId: string, options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}): Promise<N8nPage<N8nWorkflowVersionInfo>> {
    const raw = await this.request('GET', `/api/v1/workflows/${encode(workflowId)}/history`, {
      params: { limit: options.limit ?? 50, cursor: options.cursor },
      signal: options.signal,
    })
    return { items: responseItems(raw, 'data', mapWorkflowVersion), nextCursor: responseNextCursor(raw), hasMore: Boolean(responseNextCursor(raw)) }
  }

  async getWorkflowTags(workflowId: string, signal?: AbortSignal): Promise<N8nWorkflowTagInfo[]> {
    const raw = await this.request('GET', `/api/v1/workflows/${encode(workflowId)}/tags`, { signal })
    return asArray(raw).map(mapWorkflowTag)
  }

  async getExecution(executionId: string, includeData = false, signal?: AbortSignal): Promise<N8nExecutionInfo> {
    const raw = await this.request('GET', `/api/v1/executions/${encode(executionId)}`, { params: { includeData }, signal })
    return mapExecution(raw)
  }

  async setWorkflowActive(workflowId: string, active: boolean, signal?: AbortSignal): Promise<N8nWorkflowInfo> {
    const raw = await this.request('POST', `/api/v1/workflows/${encode(workflowId)}/${active ? 'publish' : 'unpublish'}`, { signal })
    return mapWorkflow(raw)
  }
}
