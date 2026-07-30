UPDATE `app_settings`
SET
	`ai_enabled` = 0,
	`ai_provider` = 'deepseek',
	`ai_model` = 'deepseek-v4-flash',
	`ai_base_url` = 'https://api.deepseek.com',
	`web_search_enabled` = 0,
	`updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `ai_provider` = 'minimax';
