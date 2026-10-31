import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "パスワード登録は終了しました。パスキーで登録してください。" },
    { status: 410 }
  );
}
