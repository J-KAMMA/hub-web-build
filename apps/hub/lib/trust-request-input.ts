import {
  HUB_TRUST_CONTEXTS,
  type HubTrustContext,
} from "@/lib/hub-trust";

const sourceServices = ["hub", "commerce", "vault", "music", "listings"] as const;
const requestTypes = ["dispute", "correction", "revocation"] as const;

const allowedEvidence = new Set([
  "publishing:vault:Vault公開実績",
  "publishing:hub:公開した投稿",
  "commerce:commerce:完了した取引",
  "work:commerce:納品完了・相互評価",
  "work:listings:公開中の依頼・サービス",
  "community:hub:運営コミュニティ",
  "monetization:hub:収益分配",
]);

export type TrustRequestInput = {
  context: HubTrustContext;
  sourceService: (typeof sourceServices)[number];
  evidenceLabel: string;
  requestType: (typeof requestTypes)[number];
  message: string;
};

function clean(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

export function containsForbiddenTrustRequestData(value: string): boolean {
  return /(?:0x[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+81|0\d{1,4})[-\s(]?\d{1,4}[-\s)]?\d{3,4})/i.test(
    value,
  );
}

export function parseTrustRequestInput(input: unknown): TrustRequestInput | null {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const context = clean(value.context, 32);
  const sourceService = clean(value.sourceService, 32);
  const evidenceLabel = clean(value.evidenceLabel, 80);
  const requestType = clean(value.requestType, 32);
  const originalMessage = typeof value.message === "string" ? value.message : "";
  const message = clean(originalMessage, 2000);
  if (
    originalMessage.length > 2000
    || !HUB_TRUST_CONTEXTS.includes(context as HubTrustContext)
    || !sourceServices.includes(sourceService as TrustRequestInput["sourceService"])
    || !requestTypes.includes(requestType as TrustRequestInput["requestType"])
    || !allowedEvidence.has(`${context}:${sourceService}:${evidenceLabel}`)
    || message.length < 20
    || containsForbiddenTrustRequestData(message)
  ) return null;
  return {
    context: context as HubTrustContext,
    sourceService: sourceService as TrustRequestInput["sourceService"],
    evidenceLabel,
    requestType: requestType as TrustRequestInput["requestType"],
    message,
  };
}
