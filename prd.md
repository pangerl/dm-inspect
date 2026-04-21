# 巡检系统 PRD

## 一、文档信息

| 项目 | 内容 |
| :--- | :--- |
| **文档名称** | 自动化巡检系统 (dm-inspect) |
| **版本** | v2.0 |
| **产品经理** | 蓝胖 |
| **目标** | 以 N9E 标签为核心，自动采集服务器资源、中间件状态、容器运行情况，生成结构化巡检报告 |

---

## 二、背景与设计理念

### 2.1 业务痛点
当前运维巡检依赖人工登录多个监控面板，缺乏结构化日报汇总。多项目、多环境告警数据混杂，难以形成统一评估。

### 2.2 核心理念

- **本系统负责**：数据聚合、统计分析、生成标准化报告
- **本系统不负责**：阈值判断、实时告警触发、探针采集
- **标签驱动隔离**：以 N9E 自定义标签（如 `group=kuvera-prod`）作为唯一过滤变量，VM 查询和 N9E 告警均通过此标签隔离，测试与生产环境 100% 互不干扰

---

## 三、系统架构

### 3.1 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 后端 | Go + Gin | 轻量、高并发，单二进制部署 |
| 前端 | React 18 + TailwindCSS + Vite | 组件化，打包为静态资源 |
| 数据库 | SQLite (WAL 模式) | 单文件，低门槛，WAL 支持并发读写 |
| 配置 | `.env` | 通过 godotenv 加载 |

### 3.2 服务端口

- **后端 API**：`:8090`（避免与微信等常用软件冲突）
- **前端静态资源**：由后端 Gin 托管，同端口

### 3.3 数据库文件说明

SQLite WAL 模式会产生三个文件：

| 文件 | 说明 |
|------|------|
| `data.db` | 主数据库，存储已提交数据 |
| `data.db-wal` | Write-Ahead Log，新写入先追加于此 |
| `data.db-shm` | 共享内存索引，加速 WAL 查找 |

> **备份**：三个文件必须同时备份。推荐用 `sqlite3 data.db ".backup backup.db"` 做一致性备份。

---

## 四、核心模块设计

### 4.1 巡检模板模块 (Template)

**功能**：定义巡检查询规则，通过 `{{.group}}` 占位符实现多环境复用。

**YAML 格式**（当前版本）：

```yaml
# 资源使用率——磁盘数据用于服务器概览列，CPU/内存通过 N9E targets API 获取
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
    extra_metrics:
      - name: "连接数"
        query: "mysql_global_status_threads_connected{group='{{.group}}'}"
      - name: "QPS"
        query: "rate(mysql_global_status_queries{group='{{.group}}'}[5m])"
  - type: redis
    query: "redis_up{group='{{.group}}'}"
    online_value: 1
    extra_metrics:
      - name: "连接数"
        query: "redis_connected_clients{group='{{.group}}'}"
      - name: "命中率"
        query: "redis_keyspace_hitrate{group='{{.group}}'}"
  - type: nacos
    query: "net_response_result_code{service='nacos',group='{{.group}}'}"
    online_value: 0   # nacos 返回 0 表示在线

# 容器运行情况
container_query: "count by(ident) (docker_container_status_started_at{container_status='running',group='{{.group}}'})"
```

> **关键**：PromQL 必须使用 `by(ident)` 分组（N9E Categraf agent 使用 `ident` 标签标识机器，而非标准 Prometheus 的 `instance`）。

**预设模板**（内置，无需手填）：

| 预设 | 适用场景 |
|------|------|
| 标准 Linux 服务器 | 纯资源监控，无中间件 |
| Linux + MySQL + Redis | 常见 Web 应用服务器 |
| Linux 全栈 | MySQL + Redis + Nacos 全套 |

**YAML 校验**：后端保存时自动解析校验，格式错误即时返回 400 + 错误原因，不等到执行时才暴露。

### 4.2 项目管理模块 (Project)

**功能**：绑定模板 + 配置 group 变量。

Variables JSON 示例：
```json
{"group": "kuvera-prod"}
```

> `group` 值必须与 N9E 中机器的自定义标签完全一致。

### 4.3 任务执行引擎 (Execution Engine)

**触发**：HTTP POST `/api/executions`，后端**异步**执行（立即返回 202），前端 1 秒后轮询报告状态。

**执行流水线（并发 4 个区块）**：

```
1. 服务器概览  ←── N9E Targets API (/api/n9e/targets?query=group%3D{group})
2. 资源使用率  ←── VM query_range (CPU/内存/磁盘，step=300s，T日全天)
3. 中间件监控  ←── VM query_instant (在线状态 + 关键指标)
4. 容器情况    ←── VM query_instant (running 容器数)
告警信息       ←── N9E alert-his-events/list (T日全天，按 group tag 过滤)
```

**时间窗口**：巡检日期当天 00:00:00 ~ 23:59:59（本地时间）

**性能保护**：
- VM 范围查询强制 `step=300`（5分钟粒度）
- 单次查询超时 15 秒
- 最多 3 个并发巡检任务

**异常保护**：任何单个区块失败，只记录日志，不阻断其他区块。goroutine 异常退出时，通过 defer 将报告状态置为 `error`，防止永远卡在 `pending`。

### 4.4 N9E Targets API 集成

**用途**：获取服务器概览信息（IP、CPU核数、CPU使用率、内存使用率、时间偏移、在线状态）

**接口**：
```
GET /api/n9e/targets?query=group%3D{group}&limit=50&p=1
Authorization: Bearer {token}
```

**字段映射**：

| N9E 字段 | 报告含义 |
|----------|----------|
| `ident` | 机器 IP |
| `cpu_num` | CPU 核数 |
| `cpu_util` | CPU 当前使用率 % |
| `mem_util` | 内存当前使用率 % |
| `offset` | 时间偏移 ms（>1000ms 标 ⚠️） |
| `target_up >= 1` | 在线 |
| `os` | 操作系统（已从报告移除，保留在数据结构中） |

---

## 五、报告结构

### 5.1 数据模型 (ReportData)

```go
type ReportData struct {
    Servers     []TargetInfo       // 区块一：服务器概览（来自 N9E Targets API）
    Resources   []ServerResource   // 区块二：磁盘数据（用于服务器概览列合并展示）
    Middlewares []MiddlewareStatus // 区块三：中间件监控
    Containers  []ContainerSummary // 区块四：容器运行情况
    Alerts      []AlertResult      // 区块五：告警信息
}
```

### 5.2 Markdown 报告格式

```markdown
# 巡检报告 - {项目名}

**巡检日期**: YYYY-MM-DD
**巡检范围**: group={group}

## 一、服务器概览
在线: N  离线: N  合计: N

| IP | 状态 | CPU核数 | CPU使用率 | 内存使用率 | 时间偏移 | 系统盘(/) | 数据盘(/data) |

## 二、中间件监控
### MYSQL / REDIS / NACOS
| 实例 | 状态 | {关键指标...} |

## 三、容器运行情况
运行中容器总数: N
| 服务器 | 运行中容器数 |

## 四、告警信息
告警总数: N  S1严重: N  S2警告: N  S3提示: N
| 规则 | 级别 | 目标 | 触发时间 | 状态 |
```

> 磁盘数据通过 VM instance `ident` 标签与服务器 IP 匹配后合并展示在服务器概览行内。

---

## 六、前端设计

### 6.1 页面结构

| 路由 | 页面 | 说明 |
|------|------|------|
| `/templates` | 模板列表 | 增删查 |
| `/templates/new` | 创建模板 | 含预设选择器 |
| `/templates/:id/edit` | 编辑模板 | 含预设选择器 |
| `/projects` | 项目列表 | 执行巡检入口 |
| `/projects/new` | 创建项目 | |
| `/reports` | 巡检报告 | 支持按项目过滤，Markdown 预览，Markdown 复制 |

### 6.2 报告页轮询机制

- 巡检异步执行，触发后 1 秒拉取一次报告列表（等待 goroutine 写入 DB）
- 报告列表中存在 `pending` 状态时，自动每 5 秒刷新
- 轮询由 `reports` 状态驱动（而非初始化一次决策），无论通过何种方式出现 pending 报告都能自动启动
- 所有 `pending` 报告完成后自动停止轮询

### 6.3 组件结构

```
web/src/
├── api.js                  # 统一 API 层，处理错误，区分 JSON/text
├── components/
│   ├── Toast.jsx           # 全局通知（Context + useToast hook）
│   ├── Badge.jsx           # 状态标签（pending/completed/error → 中文+颜色）
│   ├── Spinner.jsx         # 加载动画
│   └── EmptyState.jsx      # 空状态引导
└── pages/
    ├── TemplateList/Edit.jsx
    ├── ProjectList/Edit.jsx
    └── ReportList.jsx
```

---

## 七、使用流程

1. **创建模板**：进入「模板管理」→「创建模板」，从预设选择器选择匹配场景的模板，按需修改 PromQL
2. **创建项目**：进入「项目管理」→「创建项目」，绑定模板，填写 `{"group": "xxx"}`
3. **执行巡检**：在项目列表点击「执行巡检」，或在报告页筛选项目后点击「执行巡检」
4. **查看报告**：报告页自动轮询，完成后点击查看 Markdown 报告
5. **导出报告**：点击「复制 Markdown」，粘贴至企微/飞书/邮件

---

## 八、容错与运维

| 场景 | 处理方式 |
|------|------|
| 单指标查询失败 | 只记录日志，该区块标记异常，不阻断其他区块 |
| N9E 告警拉取失败 | 告警区块为空，报告其余部分正常生成 |
| goroutine panic | defer 将报告状态置为 `error`，不卡在 `pending` |
| VM 高并发 | step=300 限制粒度，单次超时 15s，全局最多 3 并发巡检 |
| 报告膨胀 | 每次新增后异步清理 30 天前数据 |
| 模板格式错误 | 保存时 YAML 解析校验，即时返回 400 |
| 项目删除 | 级联删除关联 reports |
| 模板被引用 | 拒绝删除，返回 409 Conflict |

---

## 九、迭代方向（非当前范围）

- **Phase 2**：Cron 定时执行，对接企业微信/飞书机器人自动推送
- **Phase 3**：周/月度趋势图，多环境横向对比，报警阈值配置
