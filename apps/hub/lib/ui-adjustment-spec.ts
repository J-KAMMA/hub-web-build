export type UiAdjustmentValues = {
  padding: number;
  gap: number;
  width: number;
  minHeight: number;
  fontSize: number;
  lineHeight: number;
  borderRadius: number;
  background: string;
  color: string;
};

export type UiAdjustmentSpec = {
  pagePath: string;
  viewportWidth: number;
  selector: string;
  values: UiAdjustmentValues;
};

export const DEFAULT_UI_ADJUSTMENT_VALUES: UiAdjustmentValues = {
  padding: 0,
  gap: 0,
  width: 0,
  minHeight: 0,
  fontSize: 0,
  lineHeight: 0,
  borderRadius: 0,
  background: "",
  color: ""
};

export function normalizePreviewPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const path = trimmed.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  if (path === "/ai/ui-adjust") return null;
  return trimmed;
}

export function adjustmentDeclarations(values: UiAdjustmentValues): string[] {
  const declarations: string[] = [];
  if (values.padding > 0) declarations.push(`padding: ${values.padding}px`);
  if (values.gap > 0) declarations.push(`gap: ${values.gap}px`);
  if (values.width > 0) declarations.push(`width: ${values.width}px`);
  if (values.minHeight > 0) declarations.push(`min-height: ${values.minHeight}px`);
  if (values.fontSize > 0) declarations.push(`font-size: ${values.fontSize}px`);
  if (values.lineHeight > 0) declarations.push(`line-height: ${values.lineHeight}`);
  if (values.borderRadius > 0) declarations.push(`border-radius: ${values.borderRadius}px`);
  if (values.background) declarations.push(`background: ${values.background}`);
  if (values.color) declarations.push(`color: ${values.color}`);
  return declarations;
}

export function previewRule(selector: string, values: UiAdjustmentValues): string {
  const declarations = adjustmentDeclarations(values);
  if (!selector || declarations.length === 0) return "";
  return `${selector} {\n${declarations.map((item) => `  ${item} !important;`).join("\n")}\n}`;
}

export function buildAdjustmentBrief(spec: UiAdjustmentSpec): string {
  const rule = previewRule(spec.selector, spec.values);
  return [
    "HubのUI調整を正式なソースへ反映してください。",
    `対象ページ: ${spec.pagePath}`,
    `確認幅: ${spec.viewportWidth}px`,
    `対象要素: ${spec.selector}`,
    "",
    "プレビューで決めた値:",
    rule || "（変更値なし）",
    "",
    "既存のレスポンシブ設計と意味トークンを保ち、最適な正規CSSへ統合してください。"
  ].join("\n");
}
