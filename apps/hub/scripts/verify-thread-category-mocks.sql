SELECT
  COUNT(*) AS threads,
  COUNT(DISTINCT board_id) AS boards,
  COUNT(DISTINCT thread_type) AS types
FROM threads
WHERE id LIKE 'category-mock-%';

SELECT COUNT(*) AS posts
FROM thread_posts
WHERE thread_id LIKE 'category-mock-%';

SELECT COUNT(*) AS summaries
FROM thread_summary_revisions
WHERE thread_id LIKE 'category-mock-%'
  AND status = 'published';

SELECT MIN(count_per_board) AS min_per_board, MAX(count_per_board) AS max_per_board
FROM (
  SELECT COUNT(*) AS count_per_board
  FROM threads
  WHERE id LIKE 'category-mock-%'
  GROUP BY board_id
);

SELECT
  SUM(CASE WHEN id LIKE 'mock-thread-%' AND status = 'archived' THEN 1 ELSE 0 END) AS archived_legacy_mocks,
  SUM(CASE WHEN id LIKE 'category-mock-%' AND status <> 'archived' THEN 1 ELSE 0 END) AS active_category_mocks,
  SUM(CASE WHEN id NOT LIKE 'mock-thread-%' AND id NOT LIKE 'category-mock-%' AND status <> 'archived' THEN 1 ELSE 0 END) AS active_real_threads
FROM threads;

SELECT setting_value AS auto_hide_report_threshold
FROM thread_safety_settings
WHERE setting_key = 'auto_hide_report_threshold';
