ALTER TABLE `assistant_contexts` ADD `has_unread` integer DEFAULT false NOT NULL;
--> statement-breakpoint
DELETE FROM `notifications`
WHERE `notification_type` = 'ai_task_complete'
  AND (
    `title_zh` IN ('双语简历同步草稿已完成', '助手修改草稿已完成', '助手简历分析已完成')
    OR `title_en` IN ('Bilingual resume sync draft ready', 'Assistant edit draft ready', 'Assistant resume review ready')
  );
