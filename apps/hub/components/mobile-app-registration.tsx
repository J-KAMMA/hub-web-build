"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    /* モバイルアプリのシェルが立てる印。Web版にウォレットは無いが、
       ネイティブ面の検出には使い続ける。 */
    hubNativeExternalWallet?: {
      readonly isHubNativeExternalWallet: true;
      open(
        wallet: "metamask" | "phantom" | "unisat" | "keplr" | "freighter",
      ): Promise<void>;
    };
  }
}

export function MobileAppRegistration() {
  const [native, setNative] = useState(false);
  const [online, setOnline] = useState(true);
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const syncNative = () => {
      const detectedNative = window.hubNativeExternalWallet?.isHubNativeExternalWallet === true;
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches === true;
      const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const androidWebView = /; wv\)/i.test(navigator.userAgent);
      const requestedSurface = new URLSearchParams(window.location.search).get("hubSurface");
      const appSurface = requestedSurface === "app" || detectedNative || standalone || iosStandalone || androidWebView;
      setNative(detectedNative);
      document.documentElement.dataset.hubSurface = appSurface ? "app" : "web";
      if (androidWebView) document.documentElement.dataset.hubNativePlatform = "android";
      else delete document.documentElement.dataset.hubNativePlatform;
      window.dispatchEvent(new CustomEvent("hub:surface-change", { detail: appSurface ? "app" : "web" }));
      return appSurface;
    };
    const syncOnline = () => setOnline(navigator.onLine);
    const appSurface = syncNative();
    syncOnline();
    window.addEventListener("hub-native-wallet-ready", syncNative);
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);

    let disposed = false;
    const watchRegistration = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) setUpdateRegistration(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateRegistration(registration);
        });
      });
    };
    const register = () => {
      if (
        !disposed &&
        document.documentElement.dataset.hubSurface === "app" &&
        "serviceWorker" in navigator &&
        window.isSecureContext
      ) {
        void navigator.serviceWorker.register("/hub-app-sw.js", { scope: "/", updateViaCache: "none" }).then(watchRegistration);
      }
    };

    const reloadAfterUpdate = () => {
      if (window.sessionStorage.getItem("hub.app-update-reload") === "true") return;
      window.sessionStorage.setItem("hub.app-update-reload", "true");
      window.location.reload();
    };
    if (appSurface) navigator.serviceWorker?.addEventListener("controllerchange", reloadAfterUpdate);

    const hapticTap = (event: PointerEvent) => {
      if (document.documentElement.dataset.hubSurface !== "app") return;
      if (event.pointerType !== "touch" || !navigator.vibrate) return;
      const target = event.target instanceof Element ? event.target.closest("button, a, [role='button']") : null;
      if (target && !target.matches(":disabled, [aria-disabled='true']")) navigator.vibrate(8);
    };
    document.addEventListener("pointerup", hapticTap, { passive: true });

    if (appSurface && "serviceWorker" in navigator && window.isSecureContext) {
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      window.removeEventListener("hub-native-wallet-ready", syncNative);
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      if (appSurface) navigator.serviceWorker?.removeEventListener("controllerchange", reloadAfterUpdate);
      document.removeEventListener("pointerup", hapticTap);
    };
  }, []);

  if (!online) return <aside className="mobile-connection-status" role="alert" data-native={native ? "true" : "false"}>
      <span><strong>オフラインです</strong><small>接続後にもう一度お試しください。入力途中の内容はそのまま保持されます。</small></span>
      <button type="button" onClick={() => window.location.reload()}>再試行</button>
    </aside>;

  if (updateRegistration) return <aside className="mobile-connection-status mobile-app-update" role="status">
      <span><strong>更新があります</strong><small>入力内容を保存してから更新してください。</small></span>
      <button type="button" onClick={() => updateRegistration.waiting?.postMessage({ type: "SKIP_WAITING" })}>更新</button>
    </aside>;

  return null;
}
