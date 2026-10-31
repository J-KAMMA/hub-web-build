import type { Metadata } from "next";

import { HubpediaEditorialPolicy } from "@/components/hubpedia-editorial-policy";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../../legal.css";
import "../../v2.css";

export const metadata: Metadata = {
  title: "Hubpediaの編集方針 | Hub v2",
  description: "Hubpediaの記事制作、AI利用、出典、訂正、広告との分離について。",
  /* 同じ文が2つの道で出る。索引は既に外へ出ている既存の道へ寄せる。 */
  alternates: { canonical: "/v2/hubpedia/about" },
};

/*
 * Hubpedia の編集方針（2026-09-04、旦那様の「古いUIを出さない」）。
 * 本文は既存と同じ部品。方針の文を2か所に置くと、片方だけ直した瞬間に
 * Hub が2つの方針を掲げることになる。
 */
export default function V2HubpediaAboutPage() {
  return (
    <V2PanelPage wide currentPath="/v2/hubpedia" title="編集方針">
      <div className="v2-readdoc"><HubpediaEditorialPolicy surface="/v2" /></div>
    </V2PanelPage>
  );
}
