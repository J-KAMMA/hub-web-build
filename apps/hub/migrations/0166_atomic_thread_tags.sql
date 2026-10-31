-- Thread discovery uses atomic tags rather than category-shaped compound labels.
-- Split legacy separators while preserving first-seen order and at most eight tags.
UPDATE threads AS thread
SET tags_json = (
  SELECT json_group_array(atom)
  FROM (
    SELECT atom
    FROM (
      SELECT
        trim(CAST(value AS TEXT)) AS atom,
        min(key) AS first_position
      FROM json_each(
        replace(
          replace(
            replace(
              replace(
                replace(thread.tags_json, '・', '","'),
                '･', '","'
              ),
              '／', '","'
            ),
            '/', '","'
          ),
          ' ', '","'
        )
      )
      WHERE type = 'text' AND trim(CAST(value AS TEXT)) <> ''
      GROUP BY lower(trim(CAST(value AS TEXT)))
      ORDER BY first_position
      LIMIT 8
    )
  )
)
WHERE json_valid(thread.tags_json)
  AND (
    thread.tags_json LIKE '%・%'
    OR thread.tags_json LIKE '%･%'
    OR thread.tags_json LIKE '%／%'
    OR thread.tags_json LIKE '%/%'
    OR thread.tags_json LIKE '% %'
  );
