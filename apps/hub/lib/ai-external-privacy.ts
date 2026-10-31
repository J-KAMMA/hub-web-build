export type ExternalPrivacyFinding = {
  kind: "secret" | "personal" | "private_context";
  label: string;
  blocking: boolean;
};

const RULES: Array<{ pattern: RegExp; finding: ExternalPrivacyFinding }> = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, finding: { kind: "secret", label: "秘密鍵", blocking: true } },
  { pattern: /\b(?:sk-[a-z0-9_-]{16,}|ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,})\b/i, finding: { kind: "secret", label: "APIキーまたはアクセストークン", blocking: true } },
  { pattern: /\b(?:seed phrase|mnemonic|秘密鍵|シードフレーズ|ニーモニック)\s*[:：]/i, finding: { kind: "secret", label: "ウォレット認証情報", blocking: true } },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, finding: { kind: "personal", label: "メールアドレス", blocking: false } },
  { pattern: /(?:\+?81[- ]?)?0\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4}/, finding: { kind: "personal", label: "電話番号らしき情報", blocking: false } },
  { pattern: /(?:非公開|社外秘|機密|confidential|internal only)/i, finding: { kind: "private_context", label: "非公開・機密の指定", blocking: false } },
];

export function inspectExternalAiPayload(text: string): { findings: ExternalPrivacyFinding[]; blocked: boolean; preview: string } {
  const findings = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.finding);
  const unique = [...new Map(findings.map((finding) => [`${finding.kind}:${finding.label}`, finding])).values()];
  return {
    findings: unique,
    blocked: unique.some((finding) => finding.blocking),
    preview: text.replace(/\s+/g, " ").trim().slice(0, 240),
  };
}
