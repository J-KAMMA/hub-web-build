import type { HubIntentRunSnapshot } from "@/lib/platform/intent-orchestrator";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function signIntentHandoffProof(
  run: HubIntentRunSnapshot,
  audience: "jkamma-ai" | "jkamma-commerce",
  privateKeyPkcs8Base64: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (
    run.objective !== "hub.orchestration.fulfill"
    || run.state !== "handoff_required"
    || !["discovery", "fulfillment"].includes(run.currentStage)
    || (
      audience === "jkamma-ai"
      && run.currentStage === "fulfillment"
      && run.commercePreview?.kind !== "ai"
    )
    || (audience === "jkamma-commerce" && run.currentStage !== "fulfillment")
    || (
      audience === "jkamma-commerce"
      && run.commercePreview?.kind === "ai"
    )
  ) throw new Error("intent_handoff_not_ready");
  if (run.commerceRequired && !run.commercePreview) {
    throw new Error("commerce_preview_required");
  }
  const header = base64Url(new TextEncoder().encode(JSON.stringify({
    alg: "EdDSA",
    typ: "JWT",
  })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    version: 1,
    iss: "jkamma-hub",
    aud: audience,
    purpose: "intent-handoff",
    jti: crypto.randomUUID(),
    intentRunId: run.id,
    stage: run.currentStage,
    commerceRequired: run.commerceRequired === true,
    commercePreview: run.commercePreview ?? null,
    iat: nowSeconds,
    exp: nowSeconds + 120,
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(privateKeyPkcs8Base64), (character) => character.charCodeAt(0)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  ));
  return `${header}.${payload}.${base64Url(signature)}`;
}
