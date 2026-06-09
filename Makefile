.PHONY: build run dev tidy clean web-build web-dev

# 后端构建
build:
	go build -o bin/server ./cmd/server

# 清理端口占用
kill-port:
	@if command -v lsof >/dev/null 2>&1; then \
		pids=$$(lsof -ti tcp:8090); \
		if [ -n "$$pids" ]; then kill $$pids; fi; \
	elif command -v fuser >/dev/null 2>&1; then \
		fuser -k 8090/tcp 2>/dev/null || true; \
	fi

# 运行（开发）- 自动清理旧进程
run: kill-port
	go run ./cmd/server

# 仅后端运行
dev: kill-port
	go run ./cmd/server

# 依赖整理
tidy:
	go mod tidy

# 清理构建产物
clean: kill-port
	rm -rf bin/

# 前端依赖安装
web-install:
	cd web && npm install

# 前端构建
web-build:
	cd web && npm run build

# 前端开发
web-dev:
	cd web && npm run dev

# 完整构建（后端 + 前端）
all: tidy build web-build

# 一键启动（需要先配置 .env）
start: build
	./bin/server
