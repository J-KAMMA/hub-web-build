import { validateLandingUrl, type HubAdFormat } from "@/lib/hub-ads";

export type HubAdPreflightCheck = {
  code: string;
  label: string;
  status: "passed" | "failed";
  message: string;
};

export type HubAdPreflightInput = {
  format: HubAdFormat;
  headline: string;
  description: string;
  callToAction: string;
  landingUrl: string;
  advertiserDisplayName: string;
  assetId?: string;
};

export function inspectHubAdCreative(input: HubAdPreflightInput) {
  const checks: HubAdPreflightCheck[] = [
    check("headline", "見出し", input.headline.trim().length > 0 && input.headline.trim().length <= 120, "1〜120文字で入力してください。"),
    check("description", "説明", input.description.trim().length <= 500, "500文字以内で入力してください。"),
    check("cta", "ボタン文言", input.callToAction.trim().length > 0 && input.callToAction.trim().length <= 40, "1〜40文字で入力してください。"),
    check("advertiser", "広告主名", input.advertiserDisplayName.trim().length > 0 && input.advertiserDisplayName.trim().length <= 120, "広告主名を入力してください。"),
    check("landing", "リンク先", Boolean(validateLandingUrl(input.landingUrl)), "短縮URLではないHTTPS URLを指定してください。"),
    check("asset", "画像", input.format !== "static_display" || Boolean(input.assetId), "画像広告には検査済み画像が必要です。"),
  ];
  return { passed: checks.every((item) => item.status === "passed"), checks };
}

function check(code: string, label: string, passed: boolean, failure: string): HubAdPreflightCheck {
  return { code, label, status: passed ? "passed" : "failed", message: passed ? "問題ありません。" : failure };
}
