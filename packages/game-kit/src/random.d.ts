export declare class Rng {
  constructor(seed: number);
  next(): number;
  between(low: number, high: number): number;
  chance(chance: number): boolean;
  pick<T>(items: readonly T[]): T | undefined;
  spread(size: number): number;
}
