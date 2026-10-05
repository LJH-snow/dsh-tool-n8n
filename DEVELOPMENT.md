# dsh-tool-n8n 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-n8n` |
| 定位 | DeepSeek Harness 的 n8n 工作流自动化插件 |
| 版本 | v0.3.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | n8n Public REST API v1 |
| 认证 | `X-N8N-API-KEY` 请求头，密钥从环境变量读取 |

### 1.1 目录

```text
src/client.ts       N8nClient：fetch 注入、超时、AbortSignal、错误映射、响应脱敏
src/index.ts        9 个 defineTool 定义与插件 apply
 tests/client.spec.ts 客户端认证、过滤、分页、历史/标签映射、状态映射、写接口测试
 tests/tools.spec.ts  工具注册、render、写操作 kind 测试
examples/cordis.yml  dsh 组合配置示例
```

## 2. 技术决策

### 2.1 认证

- 从 `apiKeyEnv` 指定的环境变量读取 API Key，默认变量名为 `N8N_API_KEY`。
- 客户端仅发送 `X-N8N-API-KEY`，不把密钥放进 URL、工具返回值、渲染文本或日志。
- 测试使用运行时随机值或外部环境变量，不在源码中写入凭据字面量。

### 2.2 工具范围

- 读：认证验证、工作流列表/详情、工作流版本历史、工作流标签、执行列表/详情。
- 写：发布、取消发布单个工作流（兼容 n8n v1 的启用/停用语义），均标记 `kind: 'edit'`。
- 不做：批量操作、删除、凭据管理、工作流定义更新、执行 payload 输出和未经验证的 webhook 触发。

### 2.3 脱敏与分页

- 工作流映射只输出 ID、名称、启用状态、时间、标签、节点数量和 URL；不输出节点、凭据或连接定义。
- 版本历史只输出版本 ID、工作流 ID、作者、名称、描述和时间，并通过官方 `history` 接口透传 cursor；不输出版本定义、节点或凭据。
- 工作流标签只输出标签 ID、名称和时间。
- 执行映射只输出状态元数据；客户端固定以 `includeData=false` 获取详情。
- 列表接口透传 n8n cursor，并返回 `hasMore` / `nextCursor`；工作流名称过滤使用官方 `name` 参数。
- 未配置 API Key 返回规范化失败结果；HTTP 错误映射为 `N8nError` 后由工具层转为失败值。

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

测试覆盖 API Key 请求头、工作流过滤和游标、工作流元数据脱敏、版本历史分页和元数据脱敏、标签元数据映射、执行 payload 脱敏、启用/停用 POST 路径、HTTP 错误、工具注册和写操作展示类型。

## 4. 后续方向

- 在确认受支持 n8n 版本的稳定接口后，增加显式 webhook/测试触发工具。
- 增加项目级过滤和更细的权限/角色说明。
- 根据 n8n API 版本变化补充兼容性测试。

## 5. endpoint 安全校验

`baseUrl` 默认行为不变（仅去尾斜杠并剥离 `/api/v1`），每次请求前额外做字面量校验：拒绝链路本地（`169.254.0.0/16`、`fe80::/10`，以及 `::/96`、`::ffff:0:0/96`、`64:ff9b::/96` 中内嵌的 IPv4 形式）与未指定地址（`0.0.0.0/8`、`::`）。默认模式**不做 DNS 解析**，因此 `http://localhost:5678` 等自建端点行为与之前完全一致。

设置 `enforcePublicEndpoint: true` 后启用完整策略：`baseUrl` 规范化为 origin + 路径前缀（禁止 credentials/query/fragment），并对解析结果做 fail-closed 校验。

n8n 天生是自建服务（默认端点即环回），因此默认不启用公网限制——否则插件开箱即坏。`src/url-security.ts` 由 `.verify/gen-url-security-b.mjs` 从 A 类模板加 B 类策略层生成，地址清单与 A 类逐行一致（18 个 IPv4 + 16 个 IPv6，对齐 IANA 注册表），不得单独修改。`lookupImpl` 仅作测试注入点，不进入插件配置接口。
