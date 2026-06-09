package store

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/mattn/go-sqlite3"
)

var DB *sql.DB

// Init 初始化 SQLite
func Init(dbPath string) error {
	var err error
	DB, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=ON")
	if err != nil {
		return err
	}
	// SQLite 不支持真正的并发写，限制为单连接避免 "database is locked" 错误
	DB.SetMaxOpenConns(1)
	DB.SetMaxIdleConns(1)

	// 验证数据库连接可用
	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	// 创建表结构
	if err := createTables(); err != nil {
		return err
	}

	log.Println("SQLite initialized successfully")
	return nil
}

func createTables() error {
	schemas := []string{
		`CREATE TABLE IF NOT EXISTS templates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			template_id INTEGER NOT NULL,
			variables TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (template_id) REFERENCES templates(id)
		);`,
		`CREATE TABLE IF NOT EXISTS reports (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL,
			report_date TEXT NOT NULL,
			data TEXT NOT NULL,
			status TEXT DEFAULT 'pending',
			error_message TEXT DEFAULT '',
			failed_blocks TEXT DEFAULT '[]',
			warnings TEXT DEFAULT '[]',
			summary TEXT DEFAULT '{}',
			block_results TEXT DEFAULT '[]',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS notification_configs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			notify_email TEXT DEFAULT '',
			notify_wechat TEXT DEFAULT '',
			enabled INTEGER DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS schedules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			cron TEXT NOT NULL,
			inspection_type TEXT DEFAULT 'daily',
			enabled INTEGER DEFAULT 1,
			notification_config_id INTEGER,
			notify_email TEXT DEFAULT '',
			notify_wechat TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (project_id) REFERENCES projects(id),
			FOREIGN KEY (notification_config_id) REFERENCES notification_configs(id)
		);`,
		`CREATE TABLE IF NOT EXISTS schedule_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			schedule_id INTEGER NOT NULL,
			report_id INTEGER,
			status TEXT,
			notified_email INTEGER DEFAULT 0,
			notified_wechat INTEGER DEFAULT 0,
			error_message TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
		);`,
	}

	for _, sql := range schemas {
		if _, err := DB.Exec(sql); err != nil {
			return err
		}
	}

	// 保留向后兼容：旧数据库启动时自动补充缺失字段
	if err := migrateReportsV3(); err != nil {
		return fmt.Errorf("failed to migrate reports table: %w", err)
	}
	if err := migrateNotificationConfigsV1(); err != nil {
		return fmt.Errorf("failed to migrate notification configs: %w", err)
	}

	return nil
}

// migrateReportsV3 为 reports 表追加 v3 所需的字段
func migrateReportsV3() error {
	// 查询当前表已有列
	rows, err := DB.Query("PRAGMA table_info(reports)")
	if err != nil {
		return err
	}
	defer rows.Close()

	existing := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dfltValue interface{}
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dfltValue, &pk); err != nil {
			return err
		}
		existing[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// 按需追加新列
	columns := []struct {
		name string
		sql  string
	}{
		{"error_message", "ALTER TABLE reports ADD COLUMN error_message TEXT DEFAULT ''"},
		{"failed_blocks", "ALTER TABLE reports ADD COLUMN failed_blocks TEXT DEFAULT '[]'"},
		{"warnings", "ALTER TABLE reports ADD COLUMN warnings TEXT DEFAULT '[]'"},
		{"summary", "ALTER TABLE reports ADD COLUMN summary TEXT DEFAULT '{}'"},
		{"block_results", "ALTER TABLE reports ADD COLUMN block_results TEXT DEFAULT '[]'"},
		{"changes", "ALTER TABLE reports ADD COLUMN changes TEXT DEFAULT '[]'"},
	}

	for _, col := range columns {
		if !existing[col.name] {
			if _, err := DB.Exec(col.sql); err != nil {
				return fmt.Errorf("add column %s failed: %w", col.name, err)
			}
			log.Printf("[migrate] added column %s to reports", col.name)
		}
	}

	return nil
}

// migrateNotificationConfigsV1 为旧 schedules 通知字段建立可复用配置
func migrateNotificationConfigsV1() error {
	existing, err := tableColumns("schedules")
	if err != nil {
		return err
	}
	if !existing["notification_config_id"] {
		if _, err := DB.Exec("ALTER TABLE schedules ADD COLUMN notification_config_id INTEGER"); err != nil {
			return fmt.Errorf("add column notification_config_id failed: %w", err)
		}
		log.Printf("[migrate] added column notification_config_id to schedules")
	}

	rows, err := DB.Query(`
		SELECT id, notify_email, notify_wechat
		FROM schedules
		WHERE COALESCE(notification_config_id, 0) = 0
		  AND (COALESCE(notify_email, '') <> '' OR COALESCE(notify_wechat, '') <> '')
		ORDER BY id
	`)
	if err != nil {
		return err
	}

	type legacyScheduleNotification struct {
		scheduleID int64
		email      string
		wechat     string
	}
	var legacyNotifications []legacyScheduleNotification
	for rows.Next() {
		var item legacyScheduleNotification
		if err := rows.Scan(&item.scheduleID, &item.email, &item.wechat); err != nil {
			rows.Close()
			return err
		}
		legacyNotifications = append(legacyNotifications, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	configIDs := make(map[string]int64)
	for _, item := range legacyNotifications {
		key := item.email + "\x00" + item.wechat
		configID, ok := configIDs[key]
		if !ok {
			name := fmt.Sprintf("迁移通知配置 %d", len(configIDs)+1)
			result, err := DB.Exec(`
				INSERT INTO notification_configs (name, notify_email, notify_wechat, enabled)
				VALUES (?, ?, ?, 1)
			`, name, item.email, item.wechat)
			if err != nil {
				return err
			}
			configID, err = result.LastInsertId()
			if err != nil {
				return err
			}
			configIDs[key] = configID
			log.Printf("[migrate] created notification config %d from schedule notification fields", configID)
		}

		if _, err := DB.Exec("UPDATE schedules SET notification_config_id = ? WHERE id = ?", configID, item.scheduleID); err != nil {
			return err
		}
	}

	return nil
}

func tableColumns(table string) (map[string]bool, error) {
	rows, err := DB.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	existing := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dfltValue interface{}
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dfltValue, &pk); err != nil {
			return nil, err
		}
		existing[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return existing, nil
}

// Close 关闭数据库连接
func Close() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}
