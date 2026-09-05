-- 段階付与の初期ルール (docs/milestone-rewards.md)。
-- 金額・上限・有効期間は管理画面 (/reward-rules) から変更できる。
--
-- per_user_limit = 1 で1人1回に限る。台帳側の冪等キーでも二重付与を防いでいるが、
-- ルール側にも上限を置いて、どちらか一方の変更で緩まないようにする。
--
-- 発行総額の上限 (global_amount_limit) は未設定にしてある。メールでの新規登録を
-- 開けたため、登録特典は「アカウントを作れば誰でも1000」になる。想定を超える発行を
-- 止めたい場合は管理画面から上限を設定すること。
INSERT INTO "reward_rules" (
  "id", "rule_code", "rule_name", "source_service", "reward_amount",
  "per_user_limit", "approval_type", "status", "display_name", "description",
  "created_at", "updated_at"
) VALUES (
  'rr_wallet_signup_bonus', 'WALLET_SIGNUP_BONUS', 'ウォレット新規登録特典',
  'OVE_WALLET', 1000, 1, 'AUTOMATIC', 'ACTIVE', '新規登録',
  'ORIウォレットに新規登録すると受け取れます。',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("rule_code") DO NOTHING;

INSERT INTO "reward_rules" (
  "id", "rule_code", "rule_name", "source_service", "reward_amount",
  "per_user_limit", "approval_type", "status", "display_name", "description",
  "created_at", "updated_at"
) VALUES (
  'rr_profile_completion_bonus', 'PROFILE_COMPLETION_BONUS', 'お客様情報ご登録特典',
  'OVE_WALLET', 1000, 1, 'AUTOMATIC', 'ACTIVE', 'お客様情報の登録',
  'お名前・ご連絡先などをご登録いただくと受け取れます。',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("rule_code") DO NOTHING;
