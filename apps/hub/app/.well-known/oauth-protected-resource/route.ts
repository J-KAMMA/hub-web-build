import { NextResponse } from "next/server";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    resource: `${origin}/mcp`,
    scopes_supported: [
      "social.read", "social.draft", "social.publish", "social.reply",
      "social.react", "social.follow", "notifications.read",
    ],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/settings#agent-access`,
  });
}
