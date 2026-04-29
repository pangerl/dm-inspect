# 阶段1：构建前端
FROM node:20-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 阶段2：构建 Go 后端（CGO 启用，因为依赖 go-sqlite3）
FROM golang:alpine AS go-builder
RUN apk add --no-cache build-base
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web-builder /app/web/dist ./web/dist
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# 阶段3：运行（最小化镜像）
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=go-builder /app/server ./server
COPY --from=go-builder /app/web/dist ./web/dist
EXPOSE 8090
# 数据卷持久化 SQLite 数据库
VOLUME ["/data"]
ENV DB_PATH=/data/data.db
ENTRYPOINT ["./server"]
