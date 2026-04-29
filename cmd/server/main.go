package main

import (
	"log"
	"os"

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

	// 初始化 SQLite（支持通过 DB_PATH 环境变量指定数据库路径）
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data.db"
	}
	if err := store.Init(dbPath); err != nil {
		log.Fatalf("Failed to init database: %v", err)
	}
	defer store.Close()

	// 初始化巡检引擎并通过依赖注入注册到 handler
	inspectorSvc := service.NewInspector(cfg.VMEndpoint, cfg.N9EEndpoint, cfg.N9EUser, cfg.N9EPass)
	handler.SetInspector(inspectorSvc)

	// 初始化通知服务
	notifierSvc := service.NewNotifier(cfg.SMTP, cfg.AppBaseURL)

	// 初始化定时任务管理器，加载并启动
	scheduleMgr := service.NewScheduleManager(inspectorSvc, notifierSvc)
	if err := scheduleMgr.LoadAll(); err != nil {
		log.Printf("[warn] 加载定时任务失败: %v", err)
	}
	scheduleMgr.Start()
	defer scheduleMgr.Stop()
	handler.SetScheduleManager(scheduleMgr)

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
