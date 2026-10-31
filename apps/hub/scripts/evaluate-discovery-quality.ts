import { evaluateDiscoveryRanking } from "../lib/discovery-quality";

type Fixture = {
  id: string;
  text: string;
  author: string;
  topic: string;
};

type Scenario = {
  id: string;
  interests: string[];
  items: Fixture[];
  topK: number;
  minTopKPrecision: number;
  minUniqueAuthors: number;
  minUniqueTopics: number;
  minExplorationSlotCount: number;
  maxConsecutiveAuthor: number;
  maxConsecutiveTopic: number;
};

const scenarios: Scenario[] = [
  {
    id: "science-cold-exploration",
    interests: ["science"],
    items: [
      { id: "science-1", text: "science research", author: "a", topic: "research" },
      { id: "science-2", text: "science laboratory", author: "a", topic: "space" },
      { id: "science-3", text: "science space", author: "b", topic: "space" },
      { id: "science-4", text: "science medicine", author: "c", topic: "medicine" },
      { id: "science-5", text: "science climate", author: "d", topic: "climate" },
      { id: "explore", text: "cooking recipe", author: "e", topic: "food" },
      { id: "science-6", text: "science physics", author: "f", topic: "physics" },
    ],
    topK: 6,
    minTopKPrecision: 5 / 6,
    minUniqueAuthors: 5,
    minUniqueTopics: 5,
    minExplorationSlotCount: 1,
    maxConsecutiveAuthor: 1,
    maxConsecutiveTopic: 1,
  },
  {
    id: "music-topic-diversity",
    interests: ["music"],
    items: [
      { id: "music-1", text: "music jazz", author: "m1", topic: "jazz" },
      { id: "music-2", text: "music rock", author: "m2", topic: "rock" },
      { id: "music-3", text: "music classical", author: "m3", topic: "classical" },
      { id: "music-4", text: "music electronic", author: "m4", topic: "electronic" },
      { id: "music-5", text: "music folk", author: "m5", topic: "folk" },
      { id: "discover", text: "travel guide", author: "m6", topic: "travel" },
    ],
    topK: 6,
    minTopKPrecision: 5 / 6,
    minUniqueAuthors: 6,
    minUniqueTopics: 6,
    minExplorationSlotCount: 1,
    maxConsecutiveAuthor: 1,
    maxConsecutiveTopic: 1,
  },
];

const results = scenarios.map((scenario) => {
  const { report } = evaluateDiscoveryRanking(
    scenario.items,
    scenario.interests,
    (item) => item,
    scenario.topK,
  );
  const failures = [
    report.topKPrecision < scenario.minTopKPrecision
      ? `topKPrecision ${report.topKPrecision} < ${scenario.minTopKPrecision}`
      : null,
    report.uniqueAuthorsInTopK < scenario.minUniqueAuthors
      ? `uniqueAuthorsInTopK ${report.uniqueAuthorsInTopK} < ${scenario.minUniqueAuthors}`
      : null,
    report.uniqueTopicsInTopK < scenario.minUniqueTopics
      ? `uniqueTopicsInTopK ${report.uniqueTopicsInTopK} < ${scenario.minUniqueTopics}`
      : null,
    report.explorationSlotCount < scenario.minExplorationSlotCount
      ? `explorationSlotCount ${report.explorationSlotCount} < ${scenario.minExplorationSlotCount}`
      : null,
    report.maxConsecutiveAuthor > scenario.maxConsecutiveAuthor
      ? `maxConsecutiveAuthor ${report.maxConsecutiveAuthor} > ${scenario.maxConsecutiveAuthor}`
      : null,
    report.maxConsecutiveTopic > scenario.maxConsecutiveTopic
      ? `maxConsecutiveTopic ${report.maxConsecutiveTopic} > ${scenario.maxConsecutiveTopic}`
      : null,
  ].filter((failure): failure is string => Boolean(failure));
  return { id: scenario.id, thresholds: scenario, report, failures };
});

const report = {
  version: 2,
  measuredAt: new Date().toISOString(),
  source: "public-metadata-fixtures",
  scenarios: results.map(({ id, thresholds, report: scenarioReport, failures }) => ({
    id,
    thresholds: {
      topK: thresholds.topK,
      minTopKPrecision: thresholds.minTopKPrecision,
      minUniqueAuthors: thresholds.minUniqueAuthors,
      minUniqueTopics: thresholds.minUniqueTopics,
      minExplorationSlotCount: thresholds.minExplorationSlotCount,
      maxConsecutiveAuthor: thresholds.maxConsecutiveAuthor,
      maxConsecutiveTopic: thresholds.maxConsecutiveTopic,
    },
    report: scenarioReport,
    failures,
  })),
  failures: results.flatMap(({ id, failures }) => failures.map((failure) => ({ id, failure }))),
};

console.log(JSON.stringify(report, null, 2));
if (report.failures.length > 0) process.exitCode = 1;
