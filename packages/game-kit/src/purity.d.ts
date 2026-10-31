export type PurityProblem = { file: string; kind: "import" | "browser"; detail: string };
export type PurityOptions = {
  /** 既定の一覧を置き換える。 */
  renderers?: string[];
  /** 見逃す取り込み先。 */
  allow?: string[];
  /** ブラウザ固有のものを許す。既定は false。 */
  allowBrowserGlobals?: boolean;
};
export declare function findRendererImports(coreDirectory: string, options?: PurityOptions): Promise<PurityProblem[]>;
export declare function assertCoreIsPure(coreDirectory: string, options?: PurityOptions): Promise<void>;
