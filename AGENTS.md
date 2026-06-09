# AGENTS.md

本文件适用于整个 `dm-inspect` 仓库。优先遵守本文件；若子目录未来出现更近的 `AGENTS.md`，以更近文件为准。

## 工作原则

- 先理解再改动。开始实现前明确假设、边界和成功标准；如果需求有多种解释，先说明取舍。
- 保持简单。只实现用户明确要求的内容，不添加 speculative feature、一次性抽象或未要求的配置化。
- 外科手术式修改。只触碰完成任务必需的文件；不要顺手重构、改格式或删除无关旧代码。
- 目标驱动。把任务转成可验证结果，例如“写出复现/覆盖用例并通过”“构建通过”“页面渲染符合 `DESIGN.md`”。
- 遇到真实不确定性时停下来说明，不要假装知道；能从仓库中查证的先查证。

## 项目速览

`dm-inspect` 是标签驱动的自动化巡检系统：

- 后端：Go + Gin，入口在 `cmd/server/main.go`，路由在 `internal/router/router.go`。
- 存储：SQLite，初始化和表结构在 `internal/store/sqlite.go`，默认 `./data.db`，可用 `DB_PATH` 覆盖。
- 巡检：VictoriaMetrics 指标查询与 Nightingale (N9E) 资产/告警数据，核心逻辑在 `internal/service/inspector.go`。
- 报告：结构化 Markdown 报告生成在 `internal/service/report_markdown.go`。
- 调度与通知：`internal/service/scheduler.go`、`internal/service/notifier.go`。
- 前端：React 18 + Vite + TailwindCSS，源码在 `web/src/`。
- 设计：`DESIGN.md` 和 `web/src/index.css` 中的 Apple 风格设计 token 是前端视觉基准。

## 常用命令

```bash
go test ./...
go build -o bin/server ./cmd/server
make run
make web-build
cd web && npm run build
cd web && npm run dev
make all
```

说明：

- `make run` / `make dev` 会先尝试清理 `8090` 端口，然后运行 `go run ./cmd/server`。
- `make all` 会执行 `go mod tidy`，可能改动 `go.mod` / `go.sum`；只有确实需要整理依赖时才使用。
- 前端开发服务器由 Vite 提供，后端生产服务从 `web/dist` 提供静态文件。

## 环境与数据

- 必需环境变量：`vm_endpoint`、`n9e_endpoint`、`n9e_user`、`n9e_pass`。
- 可选环境变量：SMTP 相关变量、`app_base_url`、`DB_PATH`、`TZ`。
- `.env` 包含本地敏感配置，禁止提交或在回复中泄露。
- `data/`、`data.db*`、`bin/`、`server`、`web/dist/`、`web/node_modules/` 是本地数据或构建产物，不要手工纳入变更。
- 涉及真实 VM/N9E/SMTP/企业微信调用时，优先使用 mock、假数据或最小范围验证；不要在不必要时触发真实巡检或通知。

## 后端约定

- 保持当前分层：HTTP 处理放在 `internal/handler/`，业务逻辑放在 `internal/service/`，模型放在 `internal/model/`，数据库访问集中在 `internal/store/`。
- 新增 API 时同步检查 `internal/router/router.go`、前端 `web/src/api.js` 和 README/API 文档是否需要更新。
- Gin handler 返回当前项目已有的 JSON 形态，例如错误使用 `gin.H{"error": "..."}`。
- SQLite 访问沿用 `database/sql` 和当前 schema 初始化方式；不要引入 ORM 或迁移框架，除非用户明确要求。
- YAML 模板校验沿用 `github.com/goccy/go-yaml`。
- PromQL 模板要特别注意 `group` 与 `ident` 标签约定，README 已说明 N9E/Categraf 使用 `ident` 而非 `instance`。
- 并发巡检、调度和通知改动要关注 goroutine 生命周期、日志可读性、重复执行和外部接口失败时的行为。

## 前端约定

- 使用 React 函数组件和现有页面结构，页面放在 `web/src/pages/`，共享组件放在 `web/src/components/`。
- API 请求统一通过 `web/src/api.js`，不要在页面中散落重复 fetch 封装。
- 视觉样式优先使用 Tailwind token 和 `web/src/index.css` 中的 `--ds-*` 变量。
- 修改视觉设计时对照 `DESIGN.md`；保留浅色/深色主题兼容。
- 图标优先使用已有的 `lucide-react`。
- 表单、列表、空状态、加载状态和错误提示应复用现有组件风格，避免新建一套不一致的 UI。
- 前端改动完成后至少运行 `cd web && npm run build`；明显影响页面布局时，用浏览器或 Playwright 做一次渲染检查。

## 验证标准

按改动范围选择最小但充分的验证：

- 后端逻辑：`go test ./...`，必要时补充聚焦单测。
- 后端编译/入口：`go build -o bin/server ./cmd/server`。
- 前端逻辑或样式：`cd web && npm run build`。
- 全量构建：`make all`，但注意它会运行 `go mod tidy`。
- Docker/部署：检查 `Dockerfile`、`docker-compose.yml`、`Jenkinsfile`，只在任务要求时构建或推送镜像。

如果无法运行某项验证，要在最终回复中说明原因和剩余风险。

## 文档与交付

- README 面向使用者；`AGENTS.md` 面向编码代理。不要把内部代理细则塞进 README。
- 修改 API、环境变量、部署方式、目录结构或用户流程时，同步更新 README 中对应部分。
- 修改前端视觉语言时，同步核对 `DESIGN.md` 是否仍然准确。
- 最终回复聚焦实际改动、验证结果和未验证风险，不要泛泛复述全部过程。
