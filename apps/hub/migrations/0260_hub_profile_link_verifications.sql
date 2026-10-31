-- プロフィールの外部リンクの本人確認（rel="me"）の結果。
-- リンク先のページに、このプロフィールへの rel="me" の逆リンクがあるかを確かめた結果だけを持つ。
-- 確認は保存時と「確認する」ボタンのときだけ。頁の表示では取りに行かない。
-- verified は24時間、それ以外は短い間隔まで取り直さない。
CREATE TABLE IF NOT EXISTS profile_link_verifications (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'error')),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, url),
  CHECK (length(url) <= 2048)
);
