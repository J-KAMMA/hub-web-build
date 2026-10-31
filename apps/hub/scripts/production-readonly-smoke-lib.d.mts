export type ProductionReadonlySmokeCheck = {
  name: string;
  healthy: boolean;
  status: number;
  latencyMs: number;
  error?: string;
};

export type ProductionReadonlySmokeReport = {
  format: "jkamma-hub-production-readonly-smoke-v1";
  healthy: boolean;
  checkedAt: string;
  origin: string;
  checks: ProductionReadonlySmokeCheck[];
};

export function productionSmokeBaseUrl(value: string): URL;

export function runProductionReadonlySmoke(options: {
  baseUrl: string;
  fetcher?: (input: URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<ProductionReadonlySmokeReport>;
