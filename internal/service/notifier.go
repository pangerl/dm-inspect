package service

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"strings"

	"github.com/gomarkdown/markdown"
	"github.com/gomarkdown/markdown/html"
	"github.com/gomarkdown/markdown/parser"
	"github.com/jordan-wright/email"

	"dm-inspect/internal/config"
	"dm-inspect/internal/model"
)

// Notifier 通知服务
type Notifier struct {
	smtp       *config.SMTPConfig
	appBaseURL string
}

// NewNotifier 创建通知服务
func NewNotifier(smtp *config.SMTPConfig, appBaseURL string) *Notifier {
	return &Notifier{
		smtp:       smtp,
		appBaseURL: appBaseURL,
	}
}

// SendEmail 发送邮件通知（Markdown 转 HTML）
func (n *Notifier) SendEmail(toAddrs []string, subject string, mdContent string) error {
	if n.smtp == nil {
		return fmt.Errorf("SMTP 未配置")
	}
	if len(toAddrs) == 0 {
		return fmt.Errorf("收件人列表为空")
	}

	// Markdown 转 HTML
	htmlContent := mdToHTML(mdContent)

	e := email.NewEmail()
	e.From = n.smtp.From
	e.To = toAddrs
	e.Subject = subject
	e.HTML = htmlContent

	addr := fmt.Sprintf("%s:%d", n.smtp.Host, n.smtp.Port)
	var auth smtp.Auth
	if n.smtp.User != "" && n.smtp.Password != "" {
		auth = smtp.PlainAuth("", n.smtp.User, n.smtp.Password, n.smtp.Host)
	}

	tlsConfig := &tls.Config{ServerName: n.smtp.Host}

	var err error
	if n.smtp.Port == 465 {
		// SSL/TLS 直连（如 Gmail、QQ 邮箱）
		err = e.SendWithTLS(addr, auth, tlsConfig)
	} else {
		// STARTTLS（端口 587 的标准方式）
		err = e.SendWithStartTLS(addr, auth, tlsConfig)
	}
	if err != nil {
		return fmt.Errorf("邮件发送失败: %w", err)
	}
	return nil
}

// SendWechat 发送企业微信机器人通知
func (n *Notifier) SendWechat(webhookURL string, projectName string, reportDate string, reportID int64, summary *model.Summary) error {
	if webhookURL == "" {
		return fmt.Errorf("webhook URL 为空")
	}

	content := n.buildWechatMessage(projectName, reportDate, reportID, summary)

	payload := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"content": content,
		},
	}

	body, _ := json.Marshal(payload)
	resp, err := http.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("企业微信请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("企业微信返回状态码 %d", resp.StatusCode)
	}
	return nil
}

// buildWechatMessage 构造企业微信机器人消息内容
func (n *Notifier) buildWechatMessage(projectName, reportDate string, reportID int64, summary *model.Summary) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("**巡检报告 - %s**\n", projectName))
	sb.WriteString(fmt.Sprintf("巡检日期: %s\n", reportDate))
	sb.WriteString(fmt.Sprintf("执行状态: %s\n\n", "已完成"))

	if summary != nil {
		sb.WriteString("异常摘要:\n")
		sb.WriteString(fmt.Sprintf("- 离线服务器: %d\n", summary.OfflineServers))
		sb.WriteString(fmt.Sprintf("- 磁盘风险: %d\n", summary.DiskCritical))
		sb.WriteString(fmt.Sprintf("- 中间件异常: %d\n", summary.MiddlewareAbnormal))
		sb.WriteString(fmt.Sprintf("- 告警 S1/S2/S3: %d/%d/%d\n\n", summary.AlertS1, summary.AlertS2, summary.AlertS3))
	}

	reportURL := fmt.Sprintf("%s/api/reports/%d/markdown", n.appBaseURL, reportID)
	if n.appBaseURL == "" {
		// 若未配置基础地址，使用相对路径（机器人中无法点击，但至少有 ID）
		reportURL = fmt.Sprintf("/api/reports/%d/markdown", reportID)
	}
	sb.WriteString(fmt.Sprintf("[查看完整报告](%s)", reportURL))

	return sb.String()
}

// mdToHTML 将 Markdown 文本转换为带样式的 HTML（邮件友好）
func mdToHTML(mdContent string) []byte {
	extensions := parser.CommonExtensions | parser.AutoHeadingIDs | parser.NoEmptyLineBeforeBlock
	p := parser.NewWithExtensions(extensions)
	doc := p.Parse([]byte(mdContent))

	htmlFlags := html.CommonFlags | html.HrefTargetBlank
	opts := html.RendererOptions{Flags: htmlFlags}
	renderer := html.NewRenderer(opts)
	body := markdown.Render(doc, renderer)

	// 包装邮件友好的样式，确保表格正常显示
	result := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }
table { border-collapse: collapse; width: 100%%; margin: 12px 0; font-size: 13px; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background-color: #f5f5f5; font-weight: 600; }
tr:nth-child(even) { background-color: #fafafa; }
code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-size: 12px; }
</style>
</head>
<body>
%s
</body>
</html>`, string(body))
	return []byte(result)
}

// AsyncNotify 异步执行邮件和企业微信通知，失败仅记录日志不阻塞
func (n *Notifier) AsyncNotify(projectName string, group string, reportDate string, report *model.Report, notifyEmail string, notifyWechat string) {
	go func() {
		if notifyEmail != "" && n.smtp != nil {
			toAddrs := parseEmailAddrs(notifyEmail)
			if len(toAddrs) > 0 {
				var reportData model.ReportData
				if err := json.Unmarshal([]byte(report.Data), &reportData); err == nil {
					md := GenerateMarkdown(projectName, group, reportDate, report.Status, report.ErrorMessage,
						report.FailedBlocks, report.Warnings, report.Summary, report.BlockResults, reportData)
					subject := fmt.Sprintf("[巡检报告] %s - %s", projectName, reportDate)
					if err := n.SendEmail(toAddrs, subject, md); err != nil {
						log.Printf("[notify] 邮件发送失败: %v", err)
					} else {
						log.Printf("[notify] 邮件已发送至 %v", toAddrs)
					}
				}
			}
		}
	}()

	go func() {
		if notifyWechat != "" {
			var summary model.Summary
			json.Unmarshal([]byte(report.Summary), &summary)
			if err := n.SendWechat(notifyWechat, projectName, reportDate, report.ID, &summary); err != nil {
				log.Printf("[notify] 企业微信发送失败: %v", err)
			} else {
				log.Printf("[notify] 企业微信已发送")
			}
		}
	}()
}

// parseEmailAddrs 解析逗号分隔的邮箱列表
func parseEmailAddrs(s string) []string {
	var addrs []string
	for _, v := range strings.Split(s, ",") {
		v = strings.TrimSpace(v)
		if v != "" {
			addrs = append(addrs, v)
		}
	}
	return addrs
}
