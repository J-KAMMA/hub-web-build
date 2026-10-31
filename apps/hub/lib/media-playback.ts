/*
 * 鳴らすのは画面にひとつ（2026-10-18、所有者承認）。
 * 音楽・Hub動画・YouTube の埋め込みのどれかが鳴り始めたら、ほかは一時停止する。
 * 閉じたり消したりはしない。止めた側は、押せばその場から続きを鳴らせる。
 *
 * 鳴らす側は鳴り始めに claimPlayback(自分の名前) を出し、
 * onPlaybackClaimed(自分の名前, 止める関数) で、ほかの名前が出たら止める。
 * 名前は鳴らす場所ごとに別にする（同じ名前どうしは止め合わない）。
 */
export const MEDIA_PLAYBACK_CLAIM_EVENT = "media:playback-claim";

export function claimPlayback(owner: string, target: Window = window): void {
  target.dispatchEvent(new CustomEvent<string>(MEDIA_PLAYBACK_CLAIM_EVENT, { detail: owner }));
}

export function onPlaybackClaimed(owner: string, pause: () => void, target: Window = window): () => void {
  const listener = (event: Event) => {
    const claimed = (event as CustomEvent<string>).detail;
    if (typeof claimed !== "string" || claimed === owner) return;
    try {
      pause();
    } catch {
      /* 片方が止められなくても、ほかの止める手は続ける */
    }
  };
  target.addEventListener(MEDIA_PLAYBACK_CLAIM_EVENT, listener);
  return () => target.removeEventListener(MEDIA_PLAYBACK_CLAIM_EVENT, listener);
}

let counter = 0;
/* 同じ部品が画面に複数あるとき（記事の埋め込みなど）の名前。 */
export function playbackOwnerId(prefix: string): string {
  counter += 1;
  return `${prefix}:${counter}`;
}

/*
 * Hub動画を視聴画面から小窓へ、小窓から視聴画面へ渡すときの再生位置（秒）。
 * 端末にも鯖にも保存しない。この画面の間だけ持つ。
 */
const handoff = new Map<string, number>();

export function rememberHandoffPosition(videoId: string, seconds: number): void {
  if (!videoId || !Number.isFinite(seconds) || seconds <= 0) return;
  handoff.set(videoId, seconds);
}

export function takeHandoffPosition(videoId: string): number {
  const seconds = handoff.get(videoId) ?? 0;
  handoff.delete(videoId);
  return seconds;
}
