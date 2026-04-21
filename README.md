# dm-inspect 巡检系统

基于标签驱动的自动化巡检系统，对接 VictoriaMetrics 指标查询与 Nightingale (N9E) 资产/告警数据，生成结构化 Markdown 巡检报告。

## 功能特性

- **服务器概览**：通过 N9E Targets API 获取在线状态、CPU/内存使用率、时间偏移，时间偏移过大自动标注警告
- **资源监控**：按机器展示系统盘 `/` 与数据盘 `/data` 磁盘使用率
- **中间件监控**：MySQL / Redis / Nacos 在线状态及关键指标（连接数、QPS、命中率等）
- **容器情况**：各机器运行中容器数汇总
- **告警聚合**：对接 N9E，应用层过滤 group 标签，按 S1/S2/S3 分级展示
- **预设模板**：3 种内置预设，一键填充 YAML，降低使用门槛
- **模板校验**：保存时后端自动校验 YAML 格式，即时报错
- **报告轮询**：巡检执行中自动每 5 秒刷新，完成后停止
- **数据维护**：SQLite 存储，30 天自动清理

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go + Gin |
| 前端 | React 18 + TailwindCSS + Vite |
| 数据库 | SQLite (WAL 模式) |
| 指标 | VictoriaMetrics |
| 告警/资产 | Nightingale (N9E) |

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
```

### 2. 构建并启动

```bash
make all    # 编译后端 + 构建前端
make run    # 启动服务
```

访问 `http://localhost:8090`

## 使用流程

### 第一步：创建模板

访问 `/templates/new`，从**预设选择器**选择匹配场景的模板（推荐），或手动填写 YAML：

```yaml
# 资源使用率（磁盘数据展示在服务器概览列）
resources:
  cpu_query: "avg by(ident) (cpu_usage_active{cpu='cpu-total',group='{{.group}}'})"
  mem_query: "avg by(ident) (mem_used_percent{group='{{.group}}'})"
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
```

> **注意**：PromQL 必须使用 `by(ident)` 分组（N9E Categraf agent 使用 `ident` 标签，而非 `instance`）

### 第二步：创建项目

访问 `/projects/new`，绑定模板并填写 variables：

```json
{"group": "kuvera-prod"}
```

> `group` 值必须与 Nightingale 中机器的自定义标签完全一致

### 第三步：执行巡检

在项目列表点击「执行巡检」，系统自动并发执行：

1. 从 N9E Targets API 拉取服务器资产信息
2. 查询 VM 当天全天资源/磁盘/容器指标（step=300s）
3. 查询各中间件在线状态及关键指标
4. 聚合 N9E 告警事件（按 group tag 过滤）

### 第四步：查看报告

访问 `/reports`，选择报告点击查看，可预览 Markdown 内容并一键复制。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/templates/presets` | 内置预设模板列表 |
| GET | `/api/templates` | 模板列表 |
| POST | `/api/templates` | 创建模板（含 YAML 格式校验） |
| GET | `/api/templates/:id` | 获取模板 |
| PUT | `/api/templates/:id` | 更新模板（含 YAML 格式校验） |
| DELETE | `/api/templates/:id` | 删除模板（被引用时拒绝） |
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/:id` | 获取项目 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目（级联删除报告） |
| POST | `/api/executions` | 触发巡检（异步，返回 202） |
| GET | `/api/reports` | 报告列表（支持 `?project_id=` 过滤） |
| GET | `/api/reports/:id` | 报告详情（含原始 JSON 数据） |
| GET | `/api/reports/:id/markdown` | Markdown 格式报告 |

## 目录结构

```
dm-inspect/
├── cmd/server/main.go        # 程序入口
├── internal/
│   ├── config/               # 配置加载（.env）
│   ├── handler/              # HTTP Handler
│   │   ├── template.go       # 含预设模板、YAML 校验
│   │   ├── project.go
│   │   ├── report.go         # Markdown 生成
│   │   └── execution.go      # 异步巡检触发
│   ├── service/
│   │   ├── inspector.go      # 巡检执行引擎（4区块并发）
│   │   ├── vm_client.go      # VM QueryRange + QueryInstant
│   │   └── n9e_client.go     # N9E 登录 / 告警 / Targets API
│   ├── model/model.go        # 数据模型（4区块结构）
│   ├── router/router.go      # 路由注册
│   └── store/sqlite.go       # SQLite 初始化
├── web/src/
│   ├── api.js                # 统一 API 封装
│   ├── components/           # Toast / Badge / Spinner / EmptyState
│   └── pages/                # 页面组件
├── .docs/                    # 变更记录
├── Makefile
└── .env.example
```

## 数据库

- SQLite 文件：`./data.db`（WAL 模式，同目录下还有 `data.db-shm` 和 `data.db-wal`）
- 报告保留：30 天（每次新增后异步清理）
- 删除项目：级联删除关联报告

## Makefile

```bash
make run        # 运行后端
make web-dev    # 前端开发模式（热更新）
make web-build  # 前端构建
make all        # 完整构建（后端编译 + 前端构建）
make clean      # 清理构建产物
```
