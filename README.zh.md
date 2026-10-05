# dsh-tool-n8n

[English](README.md) | [中文](README.zh.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 n8n 工作流自动化 Cordis 插件。Agent 可以查看工作流、版本历史、标签和执行状态，并显式启用或停用单个工作流。

## 安装

```sh
npm install @libai168/dsh-tool-n8n
```

需要 peer dependency：`@deepseek-ai/cordis`（^4.0.1）和 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）。

## 配置

```yaml
- name: 'github:LJH-snow/dsh-tool-n8n'
  config:
    baseUrl: 'https://n8n.example.com'
    apiKeyEnv: 'N8N_API_KEY'
    # timeoutMs: 15000
```

插件从 `apiKeyEnv` 指定的环境变量读取 n8n Public API Key（默认是 `N8N_API_KEY`）。不要把可用密钥写入源码、示例、测试或提交的配置文件。密钥在 n8n 的 **Settings > n8n API** 创建，并只授予部署所需的最小权限。

`baseUrl` 默认指向本机实例 `http://localhost:5678`。每次请求前都会校验目标地址。链路本地地址（`169.254.0.0/16`、`fe80::/10`，含其 IPv4-compatible、IPv4-mapped 与 NAT64 形式）以及未指定地址（`0.0.0.0/8`、`::`）始终被拒绝——它们不可能是合法的 n8n 地址，且包含云元数据地址。自建实例默认保持可用，包括环回与内网地址。设置 `enforcePublicEndpoint: true` 可额外要求主机公网可达；该模式还会解析普通域名，并拒绝环回、私有、CGNAT、组播、保留以及全部 IANA 特殊用途地址段。

## 工具

| 工具 | 说明 | 写操作 |
|---|---|---|
| `n8n_auth_test` | 验证 API Key，不回显密钥 | 否 |
| `n8n_list_workflows` | 按游标、启用状态和名称过滤工作流 | 否 |
| `n8n_get_workflow` | 查看单个工作流的元数据和设置摘要 | 否 |
| `n8n_list_workflow_versions` | 按游标查看工作流版本历史元数据 | 否 |
| `n8n_get_workflow_tags` | 查看单个工作流关联的标签元数据 | 否 |
| `n8n_list_executions` | 查看执行状态，不返回执行 payload | 否 |
| `n8n_get_execution` | 查看单个执行状态，不返回 payload | 否 |
| `n8n_stop_execution` | 停止单个运行中的执行 | 是 |
| `n8n_retry_execution` | 重试单个执行并报告新执行 | 是 |
| `n8n_activate_workflow` | 发布/启用单个工作流 | 是 |
| `n8n_deactivate_workflow` | 取消发布/停用单个工作流 | 是 |

## 安全契约

- API Key 在插件启动时从环境变量读取，不进入工具返回值或渲染文本。
- 工作流凭据、节点定义、连接关系和执行 payload 不会从客户端映射层返回。
- 写操作只针对单个工作流，并标记为 `kind: 'edit'`；不提供批量、删除、凭据或工作流定义修改工具。
- 调用方取消信号会传递给 `fetch`，默认请求超时为 15 秒。
- API 错误会规范化为 `{ ok: false, reason }` 或 `{ found: false, reason }`。

## API 范围

当前版本使用 n8n Public API 做工作流元数据、版本历史元数据、工作流标签、执行查询、执行停止/重试，以及工作流发布/取消发布（当前 API 对启用/停用的命名）。版本历史和标签只映射安全元数据，不返回工作流定义、节点、凭据、连接关系或执行 payload。Public API 没有触发工作流运行的端点（只能对已有执行做停止/重试），因此显式 webhook 触发不在范围内；工作流定义修改同样不覆盖。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 许可证

[MIT](LICENSE)
