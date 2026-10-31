"use client";

import { useEffect, useState } from "react";
import styles from "./wallet-connectivity-status.module.css";

export function WalletConnectivityStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return <aside className={styles.status} role="status">
    <strong>オフラインです</strong>
    <span>入力内容は保持されます。送金や支払いはオンラインへ戻ってから再開してください。</span>
  </aside>;
}
