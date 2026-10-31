import { notFound } from "next/navigation";

/*
 * 未知の /v2/* を v2 の not-found（app/v2/not-found.tsx）へ渡す。
 * 具体的な経路は常にこの捕捉より優先されるので、実在の画面は隠れない。
 */
export const dynamic = "force-dynamic";

export default function V2Missing() {
  notFound();
}
