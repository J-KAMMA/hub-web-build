-- 著作権の照会：7日で自動的に非公開にするのは、運営が形式確認で「明らかな侵害」と印を付けた対象だけ
-- （2026-10-15 所有者承認、docs/hub-copyright/PLAN.md 4.1）。
--
-- clearly_infringing：形式確認（received → inquiry）のときに運営が付ける印。1 のときだけ、7日の経過で自動的に非公開にする。
--   0261 の時点で照会中だった行は 0 になり、7日が過ぎると自動では隠されず、運営の判断待ちに戻る。
-- needs_decision_at：印が無いまま7日が過ぎ、定期処理が運営の列に戻した時刻。照会（inquiry）のまま、運営が判断する。
ALTER TABLE copyright_case_targets ADD COLUMN clearly_infringing INTEGER NOT NULL DEFAULT 0 CHECK (clearly_infringing IN (0,1));
ALTER TABLE copyright_case_targets ADD COLUMN needs_decision_at TEXT;

-- 運営の列：期限が過ぎて判断待ちに戻った照会だけを引く。
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_needs_decision
  ON copyright_case_targets(needs_decision_at) WHERE state = 'inquiry' AND needs_decision_at IS NOT NULL;
