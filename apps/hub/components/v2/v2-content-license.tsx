import { contentLicenseNotice, type ContentLicenseId } from "@/lib/content-license";

import "./v2-content-license.css";

/*
 * 作品の下に1行だけ出すライセンス表示（docs/hub-copyright/PLAN.md 7.2）。
 * CC は公式の頁へリンクする。全権利留保は「© 作者名　無断転載禁止」。
 */
export function V2ContentLicense({ license, authorName, japanese }: { license: ContentLicenseId; authorName?: string | null; japanese: boolean }) {
  const notice = contentLicenseNotice(license, authorName, japanese);
  return (
    <p className="v2-license" data-license={license}>
      {notice.text}
      {notice.href && notice.linkLabel ? (
        <a href={notice.href} target="_blank" rel="noopener noreferrer license">{notice.linkLabel}</a>
      ) : null}
    </p>
  );
}
