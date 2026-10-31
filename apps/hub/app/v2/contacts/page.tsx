import { redirect } from "next/navigation";

/* 連絡先はメッセージに統合した。DMの「新しい会話」が同じ一覧と開始を持つ。 */
export default function V2ContactsPage() {
  redirect("/v2/messages");
}
