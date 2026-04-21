package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

// Config 全局配置
type Config struct {
	VMEndpoint string
	N9EEndpoint string
	N9EUser    string
	N9EPass    string
}

// Load 加载配置
func Load() (*Config, error) {
	// 加载 .env 文件到环境变量
	if err := godotenv.Load(); err != nil {
		log.Printf("[config] .env file not found: %v", err)
	}

	// 直接从环境变量读取，fallback 到默认值
	vmEndpoint := os.Getenv("vm_endpoint")
	if vmEndpoint == "" {
		vmEndpoint = "http://192.168.5.151:8428"
	}
	n9eEndpoint := os.Getenv("n9e_endpoint")
	if n9eEndpoint == "" {
		n9eEndpoint = "http://192.168.5.151:17000"
	}
	n9eUser := os.Getenv("n9e_user")
	n9ePass := os.Getenv("n9e_pass")

	log.Printf("[config] Loaded: VM=%s, N9E=%s, N9E_USER=%s", vmEndpoint, n9eEndpoint, n9eUser)

	return &Config{
		VMEndpoint:  vmEndpoint,
		N9EEndpoint: n9eEndpoint,
		N9EUser:     n9eUser,
		N9EPass:     n9ePass,
	}, nil
}
