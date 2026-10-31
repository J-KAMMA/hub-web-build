"use client";

import { useEffect, useState } from "react";
import type { HardwareSigningPrompt } from "@/lib/hardware-wallet";
import { answerHardwarePrompt, subscribeHardwarePrompt } from "@/lib/hardware-wallet-prompt";
import styles from "./hardware-wallet-panel.module.css";

/** HubWalletProvider が常に描画する。どのページからの署名でも、端末へ送る前にHub側の要約を出す。 */
export function HardwareSigningDialog() {
  const [prompt, setPrompt] = useState<HardwareSigningPrompt | null>(null);
  useEffect(() => subscribeHardwarePrompt(setPrompt), []);
  if (!prompt) return null;
  return (
    <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="hardware-confirm-title">
      <h3 id="hardware-confirm-title" className={styles.title}>{prompt.review.title}</h3>
      <dl className={styles.facts}>
        <dt>口座</dt><dd>{prompt.address}</dd>
        <dt>導出パス</dt><dd>{prompt.path}</dd>
        <dt>ネットワーク</dt><dd>{prompt.chainName}</dd>
        {prompt.review.destination ? (<><dt>宛先</dt><dd>{prompt.review.destination}</dd></>) : null}
        {prompt.review.destination && prompt.review.valueHex ? (<><dt>金額(wei)</dt><dd>{BigInt(prompt.review.valueHex).toString()}</dd></>) : null}
        {prompt.nonce !== null ? (<><dt>nonce</dt><dd>{prompt.nonce}</dd></>) : null}
        {prompt.gas ? (<><dt>ガス上限</dt><dd>{prompt.gas}</dd></>) : null}
        {prompt.maxFeeWei ? (<><dt>最大手数料(wei)</dt><dd>{prompt.maxFeeWei}</dd></>) : null}
        {prompt.typed ? (
          <>
            <dt>署名先チェーンID</dt><dd>{prompt.typed.chainId ?? "指定なし"}</dd>
            <dt>verifyingContract</dt><dd>{prompt.typed.verifyingContract ?? "指定なし"}</dd>
            <dt>種別</dt><dd>{prompt.typed.primaryType ?? "不明"}</dd>
          </>
        ) : null}
        {prompt.messagePreview ? (<><dt>メッセージ</dt><dd className={styles.message}>{prompt.messagePreview}</dd></>) : null}
      </dl>
      <ul className={styles.warnings}>
        {prompt.review.warnings.map((w) => <li key={w}>{w}</li>)}
      </ul>
      <p className={styles.note}>承認すると端末に送ります。端末の画面でも内容を確認してから承認してください。</p>
      <div className={styles.buttons}>
        <button type="button" className={styles.secondary} onClick={() => answerHardwarePrompt(false)}>キャンセル</button>
        <button type="button" className={styles.action} onClick={() => answerHardwarePrompt(true)}>端末で確認する</button>
      </div>
    </div>
  );
}
