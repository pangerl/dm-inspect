# dm-inspect 巡检系统

基于标签驱动的自动化巡检系统，对接 VictoriaMetrics 指标查询与 Nightingale (N9E) 资产/告警数据，生成结构化 Markdown 巡检报告。

## 功能特性

- **服务器概览**：通过 N9E Targets API 获取在线状态、磁盘使用率、时间偏移，时间偏移过大自动标注警告
- **资源监控**：按机器展示系统盘 `/` 与数据盘 `/data` 磁盘使用率
- **中间件监控**：MySQL / Redis / Nacos 在线状态及关键指标（连接数、QPS、命中率等）
- **容器情况**：各机器运行中容器数汇总，支持展示容器服务详情（名称、镜像、状态）与端口连通状态
- **告警聚合**：对接 N9E，应用层过滤 group 标签，按 S1/S2/S3 分级展示
- **定时巡检**：基于 Cron 表达式自动执行巡检，支持邮件（HTML 完整报告）和企业微信机器人（精简摘要）通知
- **预设模板**：3 种内置预设，一键填充 YAML；支持基础模式（表单配置）与高级模式（直接编辑 YAML）
- **模板校验**：保存时后端自动校验 YAML 格式，即时报错
- **快速创建**：向导式三步流程，选择场景预设后填写 group 标签即可一键创建项目
- **报告轮询**：巡检执行中自动每 5 秒刷新，完成后停止
- **深色主题 UI**：OLED 级深色界面，基于 Tailwind 设计系统统一配色
- **数据维护**：SQLite 存储，30 天自动清理

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go + Gin |
| 前端 | React 18 + TailwindCSS + Vite |
| 设计系统 | 语义化 `ds-*` 命名空间（Background / Surface / Text / Muted / Border / Accent） |
| 数据库 | SQLite (WAL 模式) |
| 指标 | VictoriaMetrics |
| 告警/资产 | Nightingale (N9E) |
| 定时调度 | robfig/cron/v3 |
| 邮件发送 | jordan-wright/email + gomarkdown |

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
vm_endpoint=http://192.168.5.151:8428
n9e_endpoint=http://192.168.5.151:17000
n9e_user=your_username
n9e_pass=your_password

# SMTP 配置（可选，用于定时任务邮件通知）
smtp_host=smtp.exmail.qq.com
smtp_port=465
smtp_user=alert@data-match.cn
smtp_pass=your_smtp_password
smtp_from=巡检系统 <alert@data-match.cn>
app_base_url=http://localhost:8090
```

### 2. 构建并启动

```bash
make all    # 编译后端 + 构建前端
make run    # 启动服务
```

访问 `http://localhost:8090`

## 使用流程

### 方式一：快速创建（推荐）

访问 `/projects/quick-create`，三步完成：

1. **选择场景**：从预设模板中选择匹配的巡检场景
2. **填写信息**：输入项目名称和 Nightingale group 标签
3. **确认创建**：系统自动创建项目和关联模板，并生成昨日巡检报告

### 方式二：手动配置

#### 第一步：创建模板

访问 `/templates/new`，从**预设选择器**选择匹配场景的模板（推荐），或手动填写 YAML：

```yaml
# 磁盘使用率（磁盘数据展示在服务器概览列）
resources:
  disk_queries:
    - path: "/"
      query: "avg by(ident) (disk_used_percent{path='/',group='{{.group}}'})"
    - path: "/data"
      query: "avg by(ident) (disk_used_percent{path='/data',group='{{.group}}'})"

# 中间件监控（按需配置）
middlewares:
  - type: mysql
    query: "mysql_up{group='{{.group}}'}"
    online_value: 1
  - type: redis
    query: "redis_up{group='{{.group}}'}"
    online_value: 1

# 容器运行情况
container_query: "count by(ident) (docker_container_status_started_at{container_status='running',group='{{.group}}'})"
container_services_query: "docker_container_status_started_at{group='{{.group}}'}"
container_ports_query: "net_response_result_code{group='{{.group}}'}"
```

> **注意**：PromQL 必须使用 `by(ident)` 分组（N9E Categraf agent 使用 `ident` 标签，而非 `instance`）

#### 第二步：创建项目

访问 `/projects/new`，绑定模板并填写 variables：

```json
{"group": "kuvera-prod"}
```

> `group` 值必须与 Nightingale 中机器的自定义标签完全一致

#### 第三步：执行巡检

在项目列表点击「执行巡检」，系统自动并发执行：

1. 从 N9E Targets API 拉取服务器资产信息
2. 查询 VM 当天全天资源/磁盘/容器指标（step=300s）
3. 查询各中间件在线状态及关键指标
4. 聚合 N9E 告警事件（按 group tag 过滤）

#### 第四步：查看报告

访问 `/reports`，选择报告点击查看，可预览 Markdown 内容并一键复制。

### 方式三：定时自动巡检

访问 `/schedules/new`，配置 Cron 表达式自动执行：

| 预设 | 表达式 | 说明 |
|------|--------|------|
| 每天 10:00 | `0 0 10 * * *` | 生成昨日巡检报告 |
| 每天 00:00 | `0 0 0 * * *` | 凌晨自动巡检 |
| 每周一 09:00 | `0 0 9 * * 1` | 周初汇总 |
| 每月 1 日 09:00 | `0 0 9 1 * *` | 月初汇总 |

支持同时配置邮件通知（完整 HTML 报告）和企业微信机器人（精简摘要）。

## API 接口

### 模板管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/templates/presets` | 内置预设模板列表 |
| GET | `/api/templates` | 模板列表 |
| POST | `/api/templates` | 创建模板（含 YAML 格式校验） |
| GET | `/api/templates/:id` | 获取模板 |
| PUT | `/api/templates/:id` | 更新模板（含 YAML 格式校验） |
| DELETE | `/api/templates/:id` | 删除模板（被引用时拒绝） |

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 创建项目 |
| POST | `/api/projects/quick-create` | 快速创建（预设 + 名称 + group） |
| GET | `/api/projects/:id` | 获取项目 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目（级联删除报告） |

### 巡检执行

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/executions` | 触发巡检（异步，返回 202） |

### 定时任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schedules` | 定时任务列表（含下次执行时间） |
| POST | `/api/schedules` | 创建定时任务 |
| GET | `/api/schedules/:id` | 获取定时任务 |
| PUT | `/api/schedules/:id` | 更新定时任务 |
| DELETE | `/api/schedules/:id` | 删除定时任务 |
| POST | `/api/schedules/:id/run` | 手动立即执行 |
| GET | `/api/schedules/:id/logs` | 执行历史 |

### 报告查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reports` | 报告列表（支持 `?project_id=` 过滤） |
| GET | `/api/reports/:id` | 报告详情（含原始 JSON 数据） |
| GET | `/api/reports/:id/markdown` | Markdown 格式报告 |

## 目录结构

```
dm-inspect/
├── cmd/server/main.go           # 程序入口
├── internal/
│   ├── config/                  # 配置加载（.env + SMTP）
│   ├── handler/                 # HTTP Handler
│   │   ├── template.go          # 预设模板、YAML 校验
│   │   ├── project.go           # 项目 CRUD + 快速创建
│   │   ├── report.go            # Markdown 生成
│   │   ├── execution.go         # 异步巡检触发
│   │   └── schedule.go          # 定时任务 CRUD + 触发 + 历史
│   ├── service/
│   │   ├── inspector.go         # 巡检执行引擎（4 区块并发）
│   │   ├── scheduler.go         # ScheduleManager（cron 调度）
│   │   ├── notifier.go          # 邮件 + 企业微信通知
│   │   ├── report_markdown.go   # Markdown 报告生成
│   │   ├── vm_client.go         # VM QueryRange + QueryInstant
│   │   └── n9e_client.go        # N9E 登录 / 告警 / Targets API
│   ├── model/model.go           # 数据模型（4 区块 + Schedule 结构）
│   ├── router/router.go         # 路由注册
│   └── store/sqlite.go          # SQLite 初始化 + 表结构
├── web/src/
│   ├── api.js                   # 统一 API 封装
│   ├── components/              # Toast / Badge / Spinner
│   └── pages/                   # 页面组件
│       ├── ProjectList.jsx
│       ├── ProjectEdit.jsx
│       ├── ProjectQuickCreate.jsx
│       ├── TemplateList.jsx
│       ├── TemplateEdit.jsx
│       ├── ScheduleList.jsx
│       ├── ScheduleEdit.jsx
│       └── ReportList.jsx
├── .docs/                       # 变更记录
├── Makefile
└── .env.example
```

## 数据库

- SQLite 文件：`./data.db`（WAL 模式，同目录下还有 `data.db-shm` 和 `data.db-wal`）
- 报告保留：30 天（每次新增后异步清理）
- 删除项目：级联删除关联报告
- 删除定时任务：级联删除执行历史

## Makefile

```bash
make run        # 运行后端
make web-dev    # 前端开发模式（热更新）
make web-build  # 前端构建
make all        # 完整构建（后端编译 + 前端构建）
make clean      # 清理构建产物
```
