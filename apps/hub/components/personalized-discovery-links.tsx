"use client";

import { useEffect, useState } from "react";
import { clearHubInterestProfile, HUB_INTEREST_PROFILE_CHANGED_EVENT, readHubInterestProfile, topHubInterests } from "@/lib/hub-interest-profile";

export function PersonalizedDiscoveryLinks() {
  const [interest, setInterest] = useState("");
  useEffect(() => {
    const sync = () => setInterest(topHubInterests(readHubInterestProfile(), 1)[0] ?? "");
    sync();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, sync);
  }, []);
  if (!interest) return null;
  return <section className="feature-panel feature-panel--standalone" aria-label="あなたへのおすすめ">
    <div className="feature-panel__heading"><div><span>FOR YOU</span><h2>「{interest}」をもっと見る</h2></div><button type="button" className="button" onClick={() => { clearHubInterestProfile(); setInterest(""); }}>消去</button></div>
    <div className="timeline-list-panel__actions"><a className="button" href={`/search?q=${encodeURIComponent(interest)}`}>ユーザー・ポスト</a><a className="button" href={`/bbs?q=${encodeURIComponent(interest)}`}>スレッド</a><a className="button" href={`/hubpedia?q=${encodeURIComponent(interest)}`}>Hubpedia</a><a className="button" href={`/community?q=${encodeURIComponent(interest)}`}>コミュニティ</a><a className="button" href="/community">新しい分野を発見</a></div>
  </section>;
}
