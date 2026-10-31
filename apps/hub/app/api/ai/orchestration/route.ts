import { NextResponse } from "next/server";
import { HUB_SITE_TOOLS, planHubWork } from "@/lib/ai-site-orchestrator";
import {
  HUB_AI_TOOL_CAPABILITIES,
  normalizeHubWorkStep,
} from "@/lib/platform/ai-tool-capability-adapter";
import { executePlanStep } from "@/lib/server/ai-step-executor";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function GET() {
  return NextResponse.json({
    version: "1",
    policy: {
      publicReads: "automatic",
      accountReads: "explicit-consent",
      drafts: "automatic",
      writes: "confirmation-required",
      purchases: "payment-authorization-required",
    },
    tools: HUB_SITE_TOOLS,
    capabilities: HUB_AI_TOOL_CAPABILITIES,
  });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const body = await request.json().catch(() => null) as { prompt?: unknown; execute?: unknown } | null;
  if (typeof body?.prompt !== "string" || !body.prompt.trim() || [...body.prompt].length > 8_000) {
    return NextResponse.json({ error: "有効な仕事を入力してください。" }, { status: 400 });
  }
  const steps = planHubWork(body.prompt)
    .map(normalizeHubWorkStep)
    .filter((step) => step !== null);
  const flags = {
    requiresConfirmation: steps.some((step) =>
      step.capability.executionMode === "confirmation-required"
      || step.capability.executionMode === "payment-authorization-required"
    ),
    requiresPaymentAuthorization: steps.some(
      (step) =>
        step.capability.executionMode === "payment-authorization-required",
    ),
    directMessageSend: false,
    directValueMovement: false,
    executable: steps.length > 0,
  };

  if (body.execute !== true) {
    return NextResponse.json({ version: "1", steps, ...flags });
  }

  // ハーネス実行モード: read系を即時実行し、確認・決済系は境界で止める。
  const profileId = (await getOptionalHubSessionProfile(request))?.id ?? null;
  const query = body.prompt.normalize("NFKC").trim().slice(0, 100);
  const executed = await Promise.all(
    steps.map((step) => executePlanStep(step, { profileId, query })),
  );
  return NextResponse.json({
    version: "1",
    steps,
    executed,
    ...flags,
  });
}
