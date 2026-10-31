/*
 * 面に留まるための入口をひとつにまとめる（2026-09-04）。
 *
 * 部品はここだけを見ればよい。
 *   - useHubUiSurface(): いま見ている面（クライアントの部品。文脈から取る）
 *   - hubSurfacePath(): その面の中の道（サーバーの部品も呼ぶ）
 *
 * 面の配り方は lib/hub-surface-context.tsx、道の組み立ては
 * lib/hub-surface-path.ts。分かれている理由はそれぞれの先頭に書いてある。
 */
export { useHubUiSurface, HubSurfaceProvider } from "./hub-surface-context";
export { hubSurfacePath } from "./hub-surface-path";
export type { HubUiSurface } from "./hub-surface-path";
