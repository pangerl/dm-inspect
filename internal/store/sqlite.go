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
		`CREATE TABLE IF NOT EXISTS schedules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			cron TEXT NOT NULL,
			inspection_type TEXT DEFAULT 'daily',
			enabled INTEGER DEFAULT 1,
			notify_email TEXT DEFAULT '',
			notify_wechat TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (project_id) REFERENCES projects(id)
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

// Close 关闭数据库连接
func Close() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}
