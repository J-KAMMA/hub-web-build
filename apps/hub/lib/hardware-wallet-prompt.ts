// Bridge between the hardware provider (which needs a human decision) and the panel that shows
// the Hub-side summary. With no panel mounted there is nobody to ask, so the answer is "no".

import type { HardwareSigningPrompt } from "@/lib/hardware-wallet";

type Listener = (prompt: HardwareSigningPrompt | null) => void;
let listener: Listener | null = null;
let pending: ((ok: boolean) => void) | null = null;

export function subscribeHardwarePrompt(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
    answerHardwarePrompt(false);
  };
}

export function answerHardwarePrompt(ok: boolean) {
  const resolve = pending;
  pending = null;
  listener?.(null);
  resolve?.(ok);
}

export function requestHardwareConfirmation(prompt: HardwareSigningPrompt): Promise<boolean> {
  if (!listener || pending) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = resolve;
    listener?.(prompt);
  });
}
