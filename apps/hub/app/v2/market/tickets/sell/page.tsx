import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/* 出品の入口は一覧の作成欄（既存も同じ部品で、#market-ticket-create-form を開くだけ）。 */
export default function V2MarketTicketsSellPage() {
  redirect("/v2/market/tickets#market-ticket-create-form");
}
