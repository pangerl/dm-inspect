package main

import (
	"log"

	"dm-inspect/internal/config"
	"dm-inspect/internal/handler"
	"dm-inspect/internal/middleware"
	"dm-inspect/internal/router"
	"dm-inspect/internal/service"
	"dm-inspect/internal/store"

	"github.com/gin-gonic/gin"
)

func main() {
	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	log.Printf("Config loaded: VM=%s, N9E=%s, N9EUser=%s", cfg.VMEndpoint, cfg.N9EEndpoint, cfg.N9EUser)

	// 初始化 SQLite
	if err := store.Init("./data.db"); err != nil {
		log.Fatalf("Failed to init database: %v", err)
	}
	defer store.Close()

	// 初始化巡检引擎并通过依赖注入注册到 handler
	inspectorSvc := service.NewInspector(cfg.VMEndpoint, cfg.N9EEndpoint, cfg.N9EUser, cfg.N9EPass)
	handler.SetInspector(inspectorSvc)

	// 启动 Gin
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// 注册中间件
	r.Use(middleware.Recovery())
	r.Use(middleware.Logger())

	// 注册路由
	router.Setup(r)

	log.Println("Server started on :8090")
	if err := r.Run(":8090"); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
