import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "パスワードログインは終了しました。パスキーでログインしてください。" },
    { status: 410 }
  );
}
