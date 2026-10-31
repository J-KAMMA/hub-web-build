import { scoreHubInterestText } from "@/lib/hub-interest-profile";

/** Explain a matching signal only; diversity can also affect the final position. */
export function discoveryMatchingInterest(text: string, interests: readonly string[]) {
  return interests.find((term) => scoreHubInterestText(text, [term]) > 0) ?? null;
}

/** Rank public discovery metadata; preserve all candidates and cold-start order. */
export function rankDiscoveryItems<T>(
  items: readonly T[],
  interests: readonly string[],
  describe: (item: T) => { text: string; author?: string; topic?: string },
): T[] {
  if (!interests.length) return [...items];
  const remaining = items.map((item, index) => {
    const metadata = describe(item);
    return { item, index, ...metadata, score: scoreHubInterestText(metadata.text, interests) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const result: T[] = [];
  let previousAuthor: string | undefined;
  let previousTopic: string | undefined;
  while (remaining.length) {
    // Keep room for discovery instead of making every item match past interests.
    const explore = result.length > 0 && result.length % 5 === 0;
    const differsFromPrevious = (entry: typeof remaining[number]) =>
      (!previousAuthor || entry.author !== previousAuthor)
      && (!previousTopic || entry.topic !== previousTopic);
    let index = explore
      ? remaining.findIndex((entry) => entry.score === 0 && differsFromPrevious(entry))
      : -1;
    if (index < 0 && explore) index = remaining.findIndex((entry) => entry.score === 0);
    if (index < 0) index = remaining.findIndex(differsFromPrevious);
    if (index < 0) index = remaining.findIndex((entry) => !previousAuthor || entry.author !== previousAuthor);
    if (index < 0) index = remaining.findIndex((entry) => !previousTopic || entry.topic !== previousTopic);
    if (index < 0) index = 0;
    const [selected] = remaining.splice(index, 1);
    result.push(selected.item);
    previousAuthor = selected.author;
    previousTopic = selected.topic;
  }
  return result;
}
