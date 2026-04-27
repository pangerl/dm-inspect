package config

import (
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config 全局配置
type Config struct {
	VMEndpoint  string
	N9EEndpoint string
	N9EUser     string
	N9EPass     string
	SMTP        *SMTPConfig
	AppBaseURL  string // 应用对外基础地址，用于生成报告链接
}

// SMTPConfig 邮件发送配置
type SMTPConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	From     string // 发件人地址，如 "alert@example.com"
}

// Load 加载配置，必要环境变量缺失时返回错误
func Load() (*Config, error) {
	// 加载 .env 文件到环境变量（文件不存在时忽略，允许直接注入环境变量）
	if err := godotenv.Load(); err != nil {
		log.Printf("[config] .env file not found, using environment variables: %v", err)
	}

	vmEndpoint := os.Getenv("vm_endpoint")
	if vmEndpoint == "" {
		return nil, fmt.Errorf("vm_endpoint is required")
	}
	n9eEndpoint := os.Getenv("n9e_endpoint")
	if n9eEndpoint == "" {
		return nil, fmt.Errorf("n9e_endpoint is required")
	}
	n9eUser := os.Getenv("n9e_user")
	if n9eUser == "" {
		return nil, fmt.Errorf("n9e_user is required")
	}
	n9ePass := os.Getenv("n9e_pass")
	if n9ePass == "" {
		return nil, fmt.Errorf("n9e_pass is required")
	}

	log.Printf("[config] Loaded: VM=%s, N9E=%s", vmEndpoint, n9eEndpoint)

	cfg := &Config{
		VMEndpoint:  vmEndpoint,
		N9EEndpoint: n9eEndpoint,
		N9EUser:     n9eUser,
		N9EPass:     n9ePass,
		AppBaseURL:  os.Getenv("app_base_url"),
	}

	// SMTP 配置（可选）
	smtpHost := os.Getenv("smtp_host")
	if smtpHost != "" {
		port := 587
		if p := os.Getenv("smtp_port"); p != "" {
			if v, err := strconv.Atoi(p); err == nil {
				port = v
			}
		}
		cfg.SMTP = &SMTPConfig{
			Host:     smtpHost,
			Port:     port,
			User:     os.Getenv("smtp_user"),
			Password: os.Getenv("smtp_pass"),
			From:     os.Getenv("smtp_from"),
		}
		log.Printf("[config] SMTP loaded: Host=%s, Port=%d, From=%s", smtpHost, port, cfg.SMTP.From)
	}

	return cfg, nil
}
