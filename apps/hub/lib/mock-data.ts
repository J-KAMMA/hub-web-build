import fs from "fs";
import path from "path";

import { RepostCooldownError, repostRetryAt } from "@/lib/repost-cooldown";
import {
  buildBoardCatalog,
  normalizeBoardKey,
  normalizeThreads,
  syncBoardThreadCounts,
} from "@/lib/bbs-board-catalog";
import {
  calculateMultiTokenGovernanceVoteWeight,
  resolveGovernanceVoteResult,
} from "@/lib/community-governance";
import { normalizeLastReadPostNo } from "@/lib/thread-state";
import { toPublicThreadPost } from "@/lib/thread-privacy";
import { canManageThreadPost } from "@/lib/thread-post-moderation";
import {
  AppSnapshot,
  Board,
  BookmarkItem,
  Community,
  CommunityChannel,
  CommunityChannelMessage,
  CommunityChannelReaction,
  CommunityChannelReadState,
  CommunityGuideDirectory,
  CommunityGuidePage,
  CommunityGuideProposal,
  CommunityGuideReview,
  CommunityGovernanceProposal,
  CommunityGovernanceVote,
  CommunityMessageReport,
  CommunityTokenDefinition,
  CommunityMembership,
  DirectMessage,
  EngagementTargetType,
  EngagementSummary,
  FollowRelation,
  MessageConversation,
  Notification,
  Profile,
  Reaction,
  ReactionKind,
  SocialPost,
  ThreadIdentityMode,
  ThreadModerationReportView,
  ThreadPost,
  ThreadPostReport,
  ThreadPostRevision,
  ThreadReportReason,
  ThreadSummary,
  ThreadTracking,
  ThreadUserControl,
  TokenBalanceEntry,
  TokenRankingDefinition,
  UserList,
  VerificationStatus,
} from "@/lib/domain";
import {
  calculateThreadRankScore,
  rankPopularThreads,
} from "@/lib/popular-threads";
import { calculateEngagementScore } from "@/lib/engagement-score";
import { calculateSocialTrendScore, rankSocialTrends } from "@/lib/social-trends";
import {
  assertGuideMergeAllowed,
  hasIndependentGuideApproval,
  makeCommunityGuideSlug,
  normalizeGuideProposalInput,
  normalizeGuideReviewBody,
} from "@/lib/community-guide-policy";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "sekai-seifu-db.json");

const profiles: Profile[] = [
  {
    id: "profile-me",
    handle: "jkamma",
    displayName: "J Kamma",
    bio: "JKammaからのお知らせやおすすめを投稿します。",
    avatarUrl: "/jkamma-profile.avif",
    joinedAt: "2026-03-01T09:00:00.000Z",
    isCurrentUser: true,
  },
  {
    id: "profile-yoru",
    handle: "yoru_observer",
    displayName: "Yoru",
    bio: "写真、音楽、夜の散歩が好きです。",
    joinedAt: "2026-03-11T08:30:00.000Z",
  },
  {
    id: "profile-rin",
    handle: "rin_cipher",
    displayName: "Rin",
    bio: "Web制作とガジェット。たまに絵を描きます。",
    joinedAt: "2026-03-16T07:10:00.000Z",
  },
  {
    id: "profile-noa",
    handle: "noa_threads",
    displayName: "Noa",
    bio: "本と映画の感想を中心に投稿しています。",
    joinedAt: "2026-03-18T10:15:00.000Z",
  },
];

const communities: Community[] = [
  {
    id: "community-makers",
    slug: "makers",
    imageUrl: "/community-makers.webp",
    name: "ものづくりラウンジ",
    description:
      "開発、デザイン、文章など、つくる過程を持ち寄るコミュニティです。",
    category: "仕事・創作",
    knowledgeLabel: "制作Wiki",
    knowledgeDescription: "設計、材料、制作手順を共同編集するページ",
    ownerProfileId: "profile-rin",
    createdAt: "2026-03-20T09:00:00.000Z",
  },
  {
    id: "community-daily",
    slug: "daily-life",
    imageUrl: "/community-daily.webp",
    name: "暮らしと学び",
    description: "毎日の工夫、学習、料理について、試したことを共有します。",
    category: "暮らし",
    knowledgeLabel: "暮らしノート",
    knowledgeDescription: "生活の知恵や学習記録を整理するページ",
    ownerProfileId: "profile-noa",
    createdAt: "2026-03-22T09:00:00.000Z",
  },
  {
    id: "community-welcome",
    slug: "welcome",
    imageUrl: "/community-welcome.webp",
    name: "Hub はじめてガイド",
    description:
      "初めて参加する人が、使い方や過ごし方を相談できるコミュニティです。",
    category: "学び・交流",
    knowledgeLabel: "はじめてガイド",
    knowledgeDescription: "Hubの使い方を共同で整備するページ",
    ownerProfileId: "profile-me",
    createdAt: "2026-03-01T09:00:00.000Z",
  },
  {
    id: "community-fallout4",
    slug: "fallout-4-jp",
    imageUrl: "/community-fallout4.webp",
    name: "Fallout 4 攻略連邦",
    description:
      "連邦の探索、クエスト、S.P.E.C.I.A.L.・Perk構成、武器改造、パワーアーマー、拠点建築を共同で攻略するテストコミュニティです。",
    category: "ゲーム攻略",
    knowledgeLabel: "攻略",
    knowledgeDescription: "クエストやビルド情報を共同編集する攻略ページ",
    ownerProfileId: "profile-me",
    governanceMode: "dao",
    governanceVotingStrategy: "token_capped",
    governanceTokenId: "community-token-fallout4-wg",
    governanceTokensPerVote: 1000,
    governanceTokenRules: [
      {
        tokenId: "community-token-fallout4-wg",
        tokenSymbol: "WG",
        tokensPerVote: 1000,
        weight: 1,
      },
      {
        tokenId: "community-token-fallout4-caps",
        tokenSymbol: "CAPS",
        tokensPerVote: 500,
        weight: 0.5,
      },
      {
        tokenId: "community-token-fallout4-rep",
        tokenSymbol: "REP",
        tokensPerVote: 1,
        weight: 3,
      },
    ],
    governanceVoteCap: 10,
    createdAt: "2026-07-16T00:00:00.000Z",
  },
  {
    id: "community-indie-games",
    slug: "indie-games",
    name: "インディーゲーム研究会",
    description: "小さな名作の発掘、感想、攻略情報を持ち寄るコミュニティです。",
    category: "ゲーム",
    knowledgeLabel: "ゲームノート",
    knowledgeDescription: "作品別の紹介、攻略、プレイ記録を整理するページ",
    ownerProfileId: "profile-yoru",
    createdAt: "2026-07-12T09:00:00.000Z",
  },
  {
    id: "community-web-ai",
    slug: "web-ai-lab",
    name: "Web・AI 開発室",
    description: "Web開発とAI活用の実装、設計、失敗例を共有する開発コミュニティです。",
    category: "テクノロジー",
    knowledgeLabel: "開発Wiki",
    knowledgeDescription: "技術選定、実装例、運用知識を整理するページ",
    ownerProfileId: "profile-rin",
    createdAt: "2026-07-13T09:00:00.000Z",
  },
  {
    id: "community-books-cinema",
    slug: "books-cinema",
    name: "本と映画の談話室",
    description: "読み終えた本や観た映画について、ネタバレ範囲を分けて語り合います。",
    category: "本・映画",
    knowledgeLabel: "作品索引",
    knowledgeDescription: "作品情報とみんなの考察を整理するページ",
    ownerProfileId: "profile-noa",
    createdAt: "2026-07-14T09:00:00.000Z",
  },
  {
    id: "community-night-photo",
    slug: "night-photo-walk",
    name: "写真と夜散歩",
    description: "街の光、風景、撮影設定や散歩コースを静かに共有する場所です。",
    category: "写真",
    knowledgeLabel: "撮影ガイド",
    knowledgeDescription: "撮影場所、機材、設定のヒントを整理するページ",
    ownerProfileId: "profile-yoru",
    createdAt: "2026-07-15T09:00:00.000Z",
  },
  {
    id: "community-music-makers",
    slug: "music-makers",
    name: "音楽制作クラブ",
    description: "作曲、演奏、ミックスの途中経過を聴き合い、改善点を相談できます。",
    category: "音楽",
    knowledgeLabel: "制作ノート",
    knowledgeDescription: "制作手順、機材、音作りの知識を整理するページ",
    ownerProfileId: "profile-me",
    createdAt: "2026-07-16T09:00:00.000Z",
  },
  {
    id: "community-language-exchange",
    slug: "language-exchange",
    name: "ことば交換ラウンジ",
    description: "語学学習の日記、質問、会話練習を互いに助け合うコミュニティです。",
    category: "学び・交流",
    knowledgeLabel: "学習ガイド",
    knowledgeDescription: "教材、表現、学習方法を言語別に整理するページ",
    ownerProfileId: "profile-noa",
    createdAt: "2026-07-17T09:00:00.000Z",
  },
];

const communityMemberships: CommunityMembership[] = [
  {
    communityId: "community-makers",
    profileId: "profile-rin",
    role: "owner",
    joinedAt: "2026-03-20T09:00:00.000Z",
  },
  {
    communityId: "community-makers",
    profileId: "profile-me",
    role: "moderator",
    joinedAt: "2026-03-20T10:00:00.000Z",
  },
  {
    communityId: "community-makers",
    profileId: "profile-noa",
    role: "member",
    joinedAt: "2026-03-21T10:00:00.000Z",
  },
  {
    communityId: "community-daily",
    profileId: "profile-noa",
    role: "owner",
    joinedAt: "2026-03-22T09:00:00.000Z",
  },
  {
    communityId: "community-daily",
    profileId: "profile-yoru",
    role: "member",
    joinedAt: "2026-03-23T09:00:00.000Z",
  },
  {
    communityId: "community-daily",
    profileId: "profile-me",
    role: "member",
    joinedAt: "2026-03-24T09:00:00.000Z",
  },
  {
    communityId: "community-welcome",
    profileId: "profile-me",
    role: "owner",
    joinedAt: "2026-03-01T09:00:00.000Z",
  },
  {
    communityId: "community-welcome",
    profileId: "profile-yoru",
    role: "member",
    joinedAt: "2026-03-12T09:00:00.000Z",
  },
  {
    communityId: "community-welcome",
    profileId: "profile-rin",
    role: "member",
    joinedAt: "2026-03-16T09:00:00.000Z",
  },
  {
    communityId: "community-welcome",
    profileId: "profile-noa",
    role: "member",
    joinedAt: "2026-03-18T09:00:00.000Z",
  },
  {
    communityId: "community-fallout4",
    profileId: "profile-me",
    role: "owner",
    joinedAt: "2026-07-16T00:00:00.000Z",
  },
  {
    communityId: "community-fallout4",
    profileId: "profile-rin",
    role: "moderator",
    joinedAt: "2026-07-16T00:05:00.000Z",
  },
  {
    communityId: "community-fallout4",
    profileId: "profile-noa",
    role: "member",
    joinedAt: "2026-07-16T00:10:00.000Z",
  },
  ...[
    ["community-indie-games", "profile-yoru", "owner"],
    ["community-indie-games", "profile-noa", "member"],
    ["community-web-ai", "profile-rin", "owner"],
    ["community-web-ai", "profile-me", "member"],
    ["community-books-cinema", "profile-noa", "owner"],
    ["community-books-cinema", "profile-me", "member"],
    ["community-night-photo", "profile-yoru", "owner"],
    ["community-night-photo", "profile-rin", "member"],
    ["community-music-makers", "profile-me", "owner"],
    ["community-music-makers", "profile-yoru", "member"],
    ["community-language-exchange", "profile-noa", "owner"],
    ["community-language-exchange", "profile-me", "member"],
  ].map(([communityId, profileId, role], index) => ({
    communityId,
    profileId,
    role: role as "owner" | "member",
    joinedAt: `2026-07-${String(12 + Math.floor(index / 2)).padStart(2, "0")}T10:00:00.000Z`,
  })),
];

const communityChannels: CommunityChannel[] = [
  {
    id: "channel-makers-general",
    communityId: "community-makers",
    name: "一般",
    description: "制作中のことを気軽に共有する場所",
    position: 0,
    createdAt: "2026-03-20T09:05:00.000Z",
  },
  {
    id: "channel-makers-showcase",
    communityId: "community-makers",
    name: "作品紹介",
    description: "完成した作品や途中経過を見せ合う場所",
    position: 1,
    createdAt: "2026-03-20T09:06:00.000Z",
  },
  {
    id: "channel-daily-general",
    communityId: "community-daily",
    name: "暮らしの雑談",
    description: "毎日の小さな発見を共有する場所",
    position: 0,
    createdAt: "2026-03-22T09:05:00.000Z",
  },
  {
    id: "channel-daily-learning",
    communityId: "community-daily",
    name: "学びの記録",
    description: "今日学んだことを残す場所",
    position: 1,
    createdAt: "2026-03-22T09:06:00.000Z",
  },
  {
    id: "channel-welcome-start",
    communityId: "community-welcome",
    name: "はじめに",
    description: "Hubの使い方とコミュニティの案内",
    position: 0,
    createdAt: "2026-03-01T09:05:00.000Z",
  },
  {
    id: "channel-welcome-help",
    communityId: "community-welcome",
    name: "質問・相談",
    description: "操作や過ごし方について相談する場所",
    position: 1,
    createdAt: "2026-03-01T09:06:00.000Z",
  },
  {
    id: "channel-fallout4-start",
    communityId: "community-fallout4",
    name: "連邦・序盤攻略",
    description: "Vault 111を出た後の探索順と序盤の準備",
    position: 0,
    createdAt: "2026-07-16T00:01:00.000Z",
  },
  {
    id: "channel-fallout4-quests",
    communityId: "community-fallout4",
    name: "クエスト攻略",
    description: "クエストの進行、選択肢、詰まりやすい箇所",
    position: 1,
    createdAt: "2026-07-16T00:02:00.000Z",
  },
  {
    id: "channel-fallout4-builds",
    communityId: "community-fallout4",
    name: "装備・ビルド",
    description: "S.P.E.C.I.A.L.、Perk、武器改造、パワーアーマー",
    position: 2,
    createdAt: "2026-07-16T00:03:00.000Z",
  },
  {
    id: "channel-fallout4-settlements",
    communityId: "community-fallout4",
    name: "拠点建築",
    description: "居住地の資源、供給ライン、防衛と建築例",
    position: 3,
    createdAt: "2026-07-16T00:04:00.000Z",
  },
  ...[
    ["community-indie-games", "indie-games", "雑談・おすすめ", "見つけた作品やセール情報を共有"],
    ["community-indie-games", "indie-games-reviews", "作品別レビュー", "ネタバレ範囲を分けて感想を投稿"],
    ["community-web-ai", "web-ai", "開発相談", "設計、実装、エラーについて相談"],
    ["community-web-ai", "web-ai-showcase", "作ったもの", "動くデモや開発途中の成果を共有"],
    ["community-books-cinema", "books-cinema", "読書・映画ログ", "読んだ本と観た映画の記録"],
    ["community-books-cinema", "books-cinema-spoiler", "考察・ネタバレ", "結末を含む詳しい感想と考察"],
    ["community-night-photo", "night-photo", "今日の一枚", "散歩や撮影で残した写真を共有"],
    ["community-night-photo", "night-photo-tech", "機材・撮影設定", "カメラ、レンズ、現像について相談"],
    ["community-music-makers", "music-makers", "制作中", "作曲やミックスの途中経過を共有"],
    ["community-music-makers", "music-makers-feedback", "試聴・感想", "互いの作品へ具体的な感想を送る"],
    ["community-language-exchange", "language-exchange", "学習日記", "毎日の学習内容と気づきを記録"],
    ["community-language-exchange", "language-exchange-help", "質問・会話練習", "表現の質問や短い会話を練習"],
  ].map(([communityId, suffix, name, description], index) => ({
      id: `channel-${suffix}`,
      communityId,
      name,
      description,
      position: index % 2,
      createdAt: "2026-07-17T10:00:00.000Z",
    })),
];

const communityChannelMessages: CommunityChannelMessage[] = [
  {
    id: "channel-message-1",
    channelId: "channel-makers-general",
    authorProfileId: "profile-rin",
    body: "制作中のものや、いま詰まっているところを気軽に共有してください。",
    createdAt: "2026-07-14T07:10:00.000Z",
    kind: "guide",
    pinnedAt: "2026-07-14T07:20:00.000Z",
    pinnedByProfileId: "profile-me",
  },
  {
    id: "channel-message-2",
    channelId: "channel-makers-general",
    authorProfileId: "profile-me",
    body: "小さな進捗でも歓迎です。完成前の相談にも使えます。",
    createdAt: "2026-07-14T07:22:00.000Z",
    kind: "question",
    workflowStatus: "open",
  },
  {
    id: "channel-message-3",
    channelId: "channel-makers-showcase",
    authorProfileId: "profile-noa",
    body: "読書記録をまとめる小さなページを公開しました。",
    createdAt: "2026-07-14T08:05:00.000Z",
  },
  {
    id: "channel-message-4",
    channelId: "channel-daily-general",
    authorProfileId: "profile-yoru",
    body: "朝の散歩で見つけた季節の変化を共有します。",
    createdAt: "2026-07-14T06:40:00.000Z",
  },
  {
    id: "channel-message-5",
    channelId: "channel-daily-learning",
    authorProfileId: "profile-noa",
    body: "今日は短い時間でも復習を続ける方法を試しました。",
    createdAt: "2026-07-14T08:15:00.000Z",
  },
  {
    id: "channel-message-6",
    channelId: "channel-welcome-start",
    authorProfileId: "profile-me",
    body: "ようこそ。まずはプロフィールの公開名を確認して、興味のあるコミュニティに参加してください。",
    createdAt: "2026-07-14T05:30:00.000Z",
  },
  {
    id: "channel-message-7",
    channelId: "channel-welcome-help",
    authorProfileId: "profile-rin",
    body: "わからない操作があれば、画面名とやりたいことを書いてください。",
    createdAt: "2026-07-14T05:45:00.000Z",
  },
  {
    id: "channel-message-fallout4-start-guide",
    channelId: "channel-fallout4-start",
    authorProfileId: "profile-me",
    body: "Vault 111を出たら、まず周辺で装備と回復物資を確認し、サンクチュアリを探索拠点にします。攻略サイト側にチェックリストも用意しました。",
    createdAt: "2026-07-16T00:20:00.000Z",
    kind: "guide",
    pinnedAt: "2026-07-16T00:21:00.000Z",
    pinnedByProfileId: "profile-me",
  },
  {
    id: "channel-message-fallout4-start-question",
    channelId: "channel-fallout4-start",
    authorProfileId: "profile-noa",
    body: "序盤はどのPerkを優先すると探索が安定しますか？プレイスタイル別の案がほしいです。",
    createdAt: "2026-07-16T00:25:00.000Z",
    kind: "question",
    workflowStatus: "open",
  },
  {
    id: "channel-message-fallout4-quest",
    channelId: "channel-fallout4-quests",
    authorProfileId: "profile-rin",
    body: "クエスト名、現在の目的、直前に選んだ会話を添えると、ネタバレ範囲を分けて回答しやすくなります。",
    createdAt: "2026-07-16T00:30:00.000Z",
    kind: "guide",
  },
  {
    id: "channel-message-fallout4-build",
    channelId: "channel-fallout4-builds",
    authorProfileId: "profile-rin",
    body: "V.A.T.S.主体、ステルス、近接、パワーアーマーの4系統でビルド記事を分ける編集提案を出しました。",
    createdAt: "2026-07-16T00:35:00.000Z",
    kind: "chat",
  },
  {
    id: "channel-message-fallout4-settlement",
    channelId: "channel-fallout4-settlements",
    authorProfileId: "profile-noa",
    body: "供給ラインをつなぐ順番と、食料・水・防衛の確認表を作りたいです。おすすめの整理方法はありますか？",
    createdAt: "2026-07-16T00:40:00.000Z",
    kind: "question",
    workflowStatus: "open",
  },
];

const communityGuideDirectories: CommunityGuideDirectory[] = [
  {
    id: "guide-directory-fallout4-start",
    communityId: "community-fallout4",
    parentDirectoryId: null,
    slug: "start",
    name: "はじめに",
    position: 0,
    createdAt: "2026-07-16T00:08:00.000Z",
  },
  {
    id: "guide-directory-fallout4-quests",
    communityId: "community-fallout4",
    parentDirectoryId: null,
    slug: "quests",
    name: "クエスト",
    position: 1,
    createdAt: "2026-07-16T00:08:00.000Z",
  },
  {
    id: "guide-directory-fallout4-builds",
    communityId: "community-fallout4",
    parentDirectoryId: null,
    slug: "builds",
    name: "ビルド",
    position: 2,
    createdAt: "2026-07-16T00:08:00.000Z",
  },
  {
    id: "guide-directory-fallout4-settlements",
    communityId: "community-fallout4",
    parentDirectoryId: null,
    slug: "settlements",
    name: "拠点",
    position: 3,
    createdAt: "2026-07-16T00:08:00.000Z",
  },
];

const communityGuidePages: CommunityGuidePage[] = [
  {
    id: "guide-makers-start",
    communityId: "community-makers",
    slug: "first-steps",
    title: "序盤の進め方",
    body: "## 最初にやること\n\nチュートリアルを終えたら、拠点の機能を一通り開放します。\n\n## 優先順位\n\n1. デイリー任務を開放する\n2. 移動ポイントを登録する\n3. 強化素材は主力キャラクターに集中する",
    version: 2,
    updatedByProfileId: "profile-rin",
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-14T09:00:00.000Z",
  },
  {
    id: "guide-makers-boss",
    communityId: "community-makers",
    slug: "weekly-boss",
    title: "週ボス攻略",
    body: "## 推奨編成\n\n耐久役を1人、支援役を1人、残りを攻撃役にします。\n\n## 注意点\n\n第二形態の全体攻撃に合わせて防御スキルを使います。",
    version: 1,
    updatedByProfileId: "profile-me",
    createdAt: "2026-07-13T09:00:00.000Z",
    updatedAt: "2026-07-13T09:00:00.000Z",
  },
  {
    id: "guide-fallout4-first-steps",
    communityId: "community-fallout4",
    directoryId: "guide-directory-fallout4-start",
    slug: "first-steps",
    title: "連邦サバイバル・序盤チェックリスト",
    body: "## Vaultを出た直後\n\n- 周辺で武器、防具、回復物資を確認する\n- サンクチュアリで使える作業台を把握する\n- Pip-Boyのクエストとマップを整理する\n\n## 探索前の準備\n\n1. 主力武器と予備武器を決める\n2. 重量を空けてジャンクを回収できるようにする\n3. 回復と放射能対策の所持数を確認する\n4. 難易度に合わせてこまめにセーブする\n\n## この攻略の方針\n\n大きな物語のネタバレを避け、探索を安定させる準備だけをまとめます。",
    version: 1,
    updatedByProfileId: "profile-me",
    createdAt: "2026-07-16T00:10:00.000Z",
    updatedAt: "2026-07-16T00:10:00.000Z",
  },
  {
    id: "guide-fallout4-build-basics",
    communityId: "community-fallout4",
    directoryId: "guide-directory-fallout4-builds",
    slug: "build-basics",
    title: "S.P.E.C.I.A.L.とPerkの考え方",
    body: "## 先にプレイ方針を決める\n\n射撃、ステルス、近接、会話、クラフト、パワーアーマーのうち、最初に重視するものを2つ程度に絞ります。\n\n## Perk選択\n\n現在困っていることを解決するPerkを優先し、将来の完成形だけを見て序盤の戦力を落とさないようにします。\n\n## 編集提案で育てる\n\nビルド例は武器種と難易度を明記して、編集提案として追加してください。",
    version: 1,
    updatedByProfileId: "profile-rin",
    createdAt: "2026-07-16T00:12:00.000Z",
    updatedAt: "2026-07-16T00:12:00.000Z",
  },
  {
    id: "guide-fallout4-settlement-basics",
    communityId: "community-fallout4",
    directoryId: "guide-directory-fallout4-settlements",
    slug: "settlement-basics",
    title: "拠点建築の確認表",
    body: "## 基本項目\n\n- 食料\n- 水\n- ベッド\n- 防衛\n- 電力\n\n## 運用\n\n居住者数と資源の変化を確認し、足りない項目を一度に増やしすぎず順番に整えます。ジャンクは用途ごとに集め、建築前に不足素材を確認します。",
    version: 1,
    updatedByProfileId: "profile-noa",
    createdAt: "2026-07-16T00:14:00.000Z",
    updatedAt: "2026-07-16T00:14:00.000Z",
  },
];

const communityGuideProposals: CommunityGuideProposal[] = [
  {
    id: "guide-proposal-route-update",
    communityId: "community-makers",
    pageId: "guide-makers-start",
    authorProfileId: "profile-noa",
    title: "序盤ルートに素材回収を追加",
    proposedTitle: "序盤の進め方",
    proposedBody:
      "## 最初にやること\n\nチュートリアルを終えたら、拠点の機能を一通り開放します。北側の素材箱も回収しておくと強化が早くなります。\n\n## 優先順位\n\n1. デイリー任務を開放する\n2. 北側の素材箱を回収する\n3. 移動ポイントを登録する\n4. 強化素材は主力キャラクターに集中する",
    summary: "最新版で追加された序盤用の素材箱と回収順を追記します。",
    status: "open",
    baseVersion: 2,
    createdAt: "2026-07-15T06:30:00.000Z",
    updatedAt: "2026-07-15T06:30:00.000Z",
  },
  {
    id: "guide-proposal-fallout4-perk-paths",
    communityId: "community-fallout4",
    pageId: "guide-fallout4-build-basics",
    proposedDirectoryId: "guide-directory-fallout4-builds",
    authorProfileId: "profile-noa",
    title: "序盤ビルドを4系統に分ける",
    proposedTitle: "S.P.E.C.I.A.L.とPerkの考え方",
    proposedBody:
      "## 先にプレイ方針を決める\n\n射撃、ステルス、近接、パワーアーマーの4系統から主軸を1つ選び、補助要素を1つ組み合わせます。\n\n## 系統別の確認項目\n\n1. 射撃：使う武器種と弾薬の入手性\n2. ステルス：発見される距離と一撃の火力\n3. 近接：接近手段と耐久力\n4. パワーアーマー：運用資源と装備重量\n\n## Perk選択\n\n現在困っていることを解決するPerkを優先し、将来の完成形だけを見て序盤の戦力を落とさないようにします。",
    summary:
      "テストしやすいように序盤ビルドを4つの入口へ整理し、各ビルドで確認する項目を追加します。",
    status: "open",
    baseVersion: 1,
    createdAt: "2026-07-16T00:45:00.000Z",
    updatedAt: "2026-07-16T00:45:00.000Z",
  },
];

const communityGuideReviews: CommunityGuideReview[] = [
  {
    id: "guide-review-route-question",
    proposalId: "guide-proposal-route-update",
    authorProfileId: "profile-me",
    body: "素材箱の場所が分かるように方角も残しましょう。",
    decision: "comment",
    createdAt: "2026-07-15T07:00:00.000Z",
  },
  {
    id: "guide-review-fallout4-build-scope",
    proposalId: "guide-proposal-fallout4-perk-paths",
    authorProfileId: "profile-rin",
    body: "各系統に推奨難易度ではなく、弾薬・耐久・資源の負担を書けば幅広く使えそうです。",
    decision: "comment",
    createdAt: "2026-07-16T00:50:00.000Z",
  },
];

const communityGovernanceProposals: CommunityGovernanceProposal[] = [
  {
    id: "governance-fallout4-perk-guide",
    communityId: "community-fallout4",
    authorProfileId: "profile-rin",
    kind: "guide",
    title: "Perkビルドの編集提案を正式ページへ反映する",
    body: "レビュー中の編集提案を、DAO投票で承認してビルド攻略ディレクトリへ反映する提案です。",
    status: "discussion",
    votingStrategy: "one_member_one_vote",
    governanceTokenId: null,
    governanceTokenSymbol: null,
    tokensPerVote: 1,
    voteWeightCap: null,
    quorum: 2,
    approvalThreshold: 0.6,
    linkedGuideProposalId: "guide-proposal-fallout4-perk-paths",
    votingStartsAt: "2026-07-16T01:00:00.000Z",
    votingEndsAt: "2026-07-23T01:00:00.000Z",
    createdAt: "2026-07-16T00:55:00.000Z",
    updatedAt: "2026-07-16T01:10:00.000Z",
  },
];

const communityGovernanceVotes: CommunityGovernanceVote[] = [
  {
    proposalId: "governance-fallout4-perk-guide",
    profileId: "profile-rin",
    choice: "for",
    weight: 1,
    createdAt: "2026-07-16T01:05:00.000Z",
    updatedAt: "2026-07-16T01:05:00.000Z",
  },
  {
    proposalId: "governance-fallout4-perk-guide",
    profileId: "profile-noa",
    choice: "abstain",
    weight: 1,
    createdAt: "2026-07-16T01:10:00.000Z",
    updatedAt: "2026-07-16T01:10:00.000Z",
  },
];

const communityChannelReactions: CommunityChannelReaction[] = [
  {
    messageId: "channel-message-1",
    profileId: "profile-me",
    emoji: "👍",
    createdAt: "2026-07-14T07:15:00.000Z",
  },
  {
    messageId: "channel-message-1",
    profileId: "profile-noa",
    emoji: "👍",
    createdAt: "2026-07-14T07:18:00.000Z",
  },
  {
    messageId: "channel-message-3",
    profileId: "profile-rin",
    emoji: "🎉",
    createdAt: "2026-07-14T08:10:00.000Z",
  },
];

const communityChannelReadStates: CommunityChannelReadState[] = [
  {
    channelId: "channel-makers-general",
    profileId: "profile-me",
    lastReadMessageId: "channel-message-1",
    updatedAt: "2026-07-14T07:15:00.000Z",
  },
  {
    channelId: "channel-welcome-start",
    profileId: "profile-me",
    lastReadMessageId: "channel-message-6",
    updatedAt: "2026-07-14T05:35:00.000Z",
  },
];

const communityMessageReports: CommunityMessageReport[] = [];

const communityTokens: CommunityTokenDefinition[] = [
  {
    id: "community-token-makers-wg",
    communityId: "community-makers",
    name: "World Genesis",
    symbol: "WG",
    network: "Development",
    createdByProfileId: "profile-rin",
    createdAt: "2026-03-20T09:10:00.000Z",
  },
  {
    id: "community-token-daily-eth",
    communityId: "community-daily",
    name: "Ether",
    symbol: "ETH",
    network: "Ethereum",
    createdByProfileId: "profile-noa",
    createdAt: "2026-03-22T09:10:00.000Z",
  },
  {
    id: "community-token-fallout4-wg",
    communityId: "community-fallout4",
    name: "Wasteland Governance",
    symbol: "WG",
    network: "Development",
    createdByProfileId: "profile-me",
    createdAt: "2026-07-16T00:12:00.000Z",
  },
  {
    id: "community-token-fallout4-caps",
    communityId: "community-fallout4",
    name: "Commonwealth Caps",
    symbol: "CAPS",
    network: "Development",
    createdByProfileId: "profile-me",
    createdAt: "2026-07-16T00:13:00.000Z",
  },
  {
    id: "community-token-fallout4-rep",
    communityId: "community-fallout4",
    name: "Minutemen Reputation",
    symbol: "REP",
    network: "Development",
    createdByProfileId: "profile-me",
    createdAt: "2026-07-16T00:14:00.000Z",
  },
];

const notifications: Notification[] = [
  {
    id: "notif-1",
    receiverProfileId: "profile-me",
    actorProfileId: "profile-yoru",
    type: "social_reply",
    targetType: "social_post",
    targetId: "social-204",
    text: "Yoru Observer があなたのポストに返信しました。",
    isRead: false,
    createdAt: "2026-07-14T09:45:00.000Z",
  },
  {
    id: "notif-2",
    receiverProfileId: "profile-me",
    actorProfileId: "profile-noa",
    type: "thread_reply",
    targetType: "thread",
    targetId: "thread-88",
    text: "Noa Threads があなたのスレにレスしました。",
    isRead: false,
    createdAt: "2026-07-14T08:30:00.000Z",
  },
  {
    id: "notif-3",
    receiverProfileId: "profile-me",
    actorProfileId: "profile-rin",
    type: "followed",
    targetType: "profile",
    targetId: "profile-me",
    text: "Rin Cipher があなたをフォローしました。",
    isRead: true,
    createdAt: "2026-07-13T12:10:00.000Z",
  },
  {
    id: "notif-4",
    receiverProfileId: "profile-me",
    actorProfileId: "profile-yoru",
    type: "social_reaction",
    targetType: "social_post",
    targetId: "social-204",
    text: "Yoru Observer があなたのポストにいいねしました。",
    isRead: false,
    createdAt: "2026-07-14T09:20:00.000Z",
  },
  {
    id: "notif-5",
    receiverProfileId: "profile-me",
    actorProfileId: "profile-rin",
    type: "message_received",
    targetType: "message_conversation",
    targetId: "conv-rin",
    text: "Rin Cipher から新しいメッセージが2件届いています。",
    isRead: false,
    createdAt: "2026-07-14T08:05:00.000Z",
  },
  {
    id: "notif-6",
    receiverProfileId: "profile-me",
    actorProfileId: "profile-noa",
    type: "social_repost",
    targetType: "social_post",
    targetId: "social-204",
    text: "Noa Threads があなたのポストをリポストしました。",
    isRead: true,
    createdAt: "2026-07-13T10:35:00.000Z",
  },
  {
    id: "notif-7",
    receiverProfileId: "profile-me",
    actorProfileId: null,
    type: "system",
    targetType: "system",
    targetId: "community-guidelines",
    text: "コミュニティガイドラインを更新しました。",
    isRead: true,
    createdAt: "2026-07-12T03:00:00.000Z",
  },
];

const follows: FollowRelation[] = [
  {
    followerProfileId: "profile-yoru",
    followedProfileId: "profile-me",
  },
  {
    followerProfileId: "profile-me",
    followedProfileId: "profile-rin",
  },
];

const boards: Board[] = [
  {
    id: "board-idea",
    key: "idea",
    title: "アイデア掲示板",
    slug: "/bbs/idea",
    description: "アイデアや改善案を気軽に共有する板です。",
    threadCount: 3,
  },
  {
    id: "board-dev",
    key: "dev",
    title: "開発掲示板",
    slug: "/bbs/dev",
    description: "実装、UI、API、handoff の進め方をまとめます。",
    threadCount: 2,
  },
  {
    id: "board-law",
    key: "law",
    title: "サポート掲示板",
    slug: "/bbs/law",
    description: "使い方、困りごと、コミュニティ運営について話します。",
    threadCount: 1,
  },
];

const threads: ThreadSummary[] = [
  {
    id: "thread-88",
    boardKey: "cat06-board05",
    title: "短い文章への感想を、書き手が活かしやすい形で伝えるには",
    postCount: 3,
    updatedAt: "2026-07-14T08:30:00.000Z",
    pinned: true,
  },
  {
    id: "thread-104",
    boardKey: "cat03-board02",
    title: "小さなWebアプリの不具合を再現しやすく報告するテンプレート",
    postCount: 4,
    updatedAt: "2026-07-14T07:40:00.000Z",
  },
  {
    id: "thread-205",
    boardKey: "cat16-board01",
    title: "初めての人向け：スレッドを探すときに役立つ3つの入口",
    postCount: 3,
    updatedAt: "2026-07-13T12:20:00.000Z",
  },
  {
    id: "thread-301",
    boardKey: "cat01-board01",
    title: "暑い日の朝を少し楽にする、5分でできる工夫",
    postCount: 3,
    updatedAt: "2026-07-14T06:50:00.000Z",
  },
  {
    id: "thread-302",
    boardKey: "cat04-board04",
    title: "毎日15分の学習を一か月続けるための記録方法",
    postCount: 3,
    updatedAt: "2026-07-13T10:10:00.000Z",
  },
  {
    id: "thread-303",
    boardKey: "cat17-board02",
    title: "平日の夕食を迷わないための『食材3つ』献立メモ",
    postCount: 3,
    updatedAt: "2026-07-12T11:30:00.000Z",
  },
];

const threadPosts: ThreadPost[] = [
  {
    id: "thread-88-post-1",
    threadId: "thread-88",
    no: 1,
    authorProfileId: "profile-me",
    displayName: "WGHコミュニティ運営",
    body: "掌編を投稿したとき、感想が『よかった』だけだと次の推敲に結びつけにくいと感じました。①印象に残った一文、②そう感じた理由、③もっと読みたい点、の順で伝える形はどうでしょうか。書き手が求めている感想の種類を最初に確認する工夫も知りたいです。",
    createdAt: "2026-07-14T06:00:00.000Z",
  },
  {
    id: "thread-88-post-2",
    threadId: "thread-88",
    no: 2,
    authorProfileId: "profile-noa",
    displayName: "Noa Threads",
    body: "その3点は受け取りやすいと思います。私は冒頭に『感想中心／改善案も歓迎』のような札を付けています。改善案を書く場合も、まず作品が目指していそうな方向を自分の言葉で確認すると、好みの押しつけを減らせました。",
    createdAt: "2026-07-14T07:10:00.000Z",
  },
  {
    id: "thread-88-post-3",
    threadId: "thread-88",
    no: 3,
    authorProfileId: "profile-rin",
    displayName: "Rin Cipher",
    body: "具体例として『駅の音が消える場面で静けさが伝わった。直前まで会話が続いていたため、切り替わりが際立った』のように、箇所と理由をセットにすると再現性があります。指摘は一度に一、二点に絞ると話し合いやすそうです。",
    createdAt: "2026-07-14T08:30:00.000Z",
  },
  {
    id: "thread-104-post-1",
    threadId: "thread-104",
    no: 1,
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    body: "開発者に状況を伝えるときの項目を整理したいです。いまは『期待した動作／実際の動作／再現手順／環境／発生頻度』を使っています。スクリーンショットがなくても調査を始めやすい書き方のコツはありますか。",
    createdAt: "2026-07-14T04:50:00.000Z",
  },
  {
    id: "thread-104-post-2",
    threadId: "thread-104",
    no: 2,
    authorProfileId: "profile-rin",
    displayName: "Rin Cipher",
    body: "再現手順は『ログイン→検索欄に○○と入力→結果の2件目を選択』のように、一行一操作で番号を振ると読みやすいです。入力した値と、どの画面から始めたかも残すと、条件の違いを見つけやすくなります。",
    createdAt: "2026-07-14T05:35:00.000Z",
    replyToPostId: "thread-104-post-1",
  },
  {
    id: "thread-104-post-3",
    threadId: "thread-104",
    no: 3,
    authorProfileId: "profile-me",
    displayName: "WGHコミュニティ運営",
    body: "個人情報や認証情報が写り込まないよう確認する注意書きも加えたいです。エラー文は省略せず、秘密情報を除いたうえで文字として貼ると検索できます。『一度だけ』も有用な情報なので、再現しない場合は試した回数を書いておくとよさそうです。",
    createdAt: "2026-07-14T06:25:00.000Z",
  },
  {
    id: "thread-104-post-4",
    threadId: "thread-104",
    no: 4,
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    body: "まとめると、最小構成は『開始画面、番号付き操作、期待結果、実際の結果、環境、頻度』ですね。最後に回避方法の有無も加えたテンプレートを作って、次に報告するとき試してみます。",
    createdAt: "2026-07-14T07:40:00.000Z",
    replyToPostId: "thread-104-post-3",
  },
  {
    id: "thread-205-post-1",
    threadId: "thread-205",
    no: 1,
    authorProfileId: "profile-rin",
    displayName: "Rin Cipher",
    body: "話題が多くて迷うときは、①トップの新着、②カテゴリ一覧、③検索、の順に見ると目的のスレッドを探しやすいです。まず新着で雰囲気を知り、探したいテーマが決まっていればカテゴリか検索へ進む使い分けを提案します。",
    createdAt: "2026-07-13T09:00:00.000Z",
  },
  {
    id: "thread-205-post-2",
    threadId: "thread-205",
    no: 2,
    authorProfileId: "profile-noa",
    displayName: "Noa Threads",
    body: "検索では長い質問文より、『朝 学習 記録』のように中心語を二、三個にすると見つけやすいことがあります。見つからなければ「質問・相談」板で、試した検索語も添えて聞くと重複を避けられます。",
    createdAt: "2026-07-13T10:15:00.000Z",
  },
  {
    id: "thread-205-post-3",
    threadId: "thread-205",
    no: 3,
    authorProfileId: "profile-me",
    displayName: "WGHコミュニティ運営",
    body: "補足です。読んだスレッドはブックマークやリストにまとめると、あとから続きを追いやすくなります。操作で迷った場合は、使っている端末と画面名を添えてこの板に投稿してください。公開してよい情報だけを書くようお願いします。",
    createdAt: "2026-07-13T12:20:00.000Z",
  },
  {
    id: "thread-301-post-1",
    threadId: "thread-301",
    no: 1,
    authorProfileId: "profile-noa",
    displayName: "Noa Threads",
    body: "朝から暑い日は、起きてすぐカーテンを閉め直し、常温の飲み物を用意してから身支度を始めています。五分以内でできて、出かける前の慌ただしさが少し減りました。みなさんの小さな工夫も知りたいです。",
    createdAt: "2026-07-14T05:20:00.000Z",
  },
  {
    id: "thread-301-post-2",
    threadId: "thread-301",
    no: 2,
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    body: "前夜にかばんと鍵を同じ場所へ置き、朝は天気と交通情報だけ確認するようにしています。判断する項目を減らすと、暑さで集中しにくい日も出発が安定しました。",
    createdAt: "2026-07-14T06:05:00.000Z",
  },
  {
    id: "thread-301-post-3",
    threadId: "thread-301",
    no: 3,
    authorProfileId: "profile-rin",
    displayName: "Rin Cipher",
    body: "机の上に『持つもの三点』だけを書いた小さなメモを置いています。毎日同じ確認にしておくと忘れ物が減りました。無理なく続く工夫を一つずつ試すのがよさそうですね。",
    createdAt: "2026-07-14T06:50:00.000Z",
  },
  {
    id: "thread-302-post-1",
    threadId: "thread-302",
    no: 1,
    authorProfileId: "profile-rin",
    displayName: "Rin Cipher",
    body: "一か月だけ、日付と『始めた時刻／学んだこと一行／次にやること一行』を記録しようと思います。細かい時間集計より、次回の入口を残すほうが再開しやすいのではと考えています。",
    createdAt: "2026-07-13T07:30:00.000Z",
  },
  {
    id: "thread-302-post-2",
    threadId: "thread-302",
    no: 2,
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    body: "私も似た記録をしています。できなかった日は空欄にせず『休み』と書くと、記録そのものをやめずに済みました。週末に七日分を見て、翌週の教材を一つだけ決めています。",
    createdAt: "2026-07-13T08:40:00.000Z",
  },
  {
    id: "thread-302-post-3",
    threadId: "thread-302",
    no: 3,
    authorProfileId: "profile-noa",
    displayName: "Noa Threads",
    body: "成果ではなく着手を記録するのもよさそうです。十五分未満でも教材を開いたら印を付け、余裕がある日に先へ進む形なら、忙しい週も続けやすいと思います。",
    createdAt: "2026-07-13T10:10:00.000Z",
  },
  {
    id: "thread-303-post-1",
    threadId: "thread-303",
    no: 1,
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    body: "献立を『主食＋たんぱく源＋野菜』の三つでメモしています。たとえば、うどん・卵・小松菜なら一つの鍋で作れます。調味料は家にある前提にすると買い物メモも短くなりました。",
    createdAt: "2026-07-12T08:15:00.000Z",
  },
  {
    id: "thread-303-post-2",
    threadId: "thread-303",
    no: 2,
    authorProfileId: "profile-noa",
    displayName: "Noa Threads",
    body: "私は、ごはん・豆腐・冷凍野菜を基本セットにしています。余裕がある日は薬味や汁物を足し、忙しい日はそのまま。完成形を一つに決めないほうが、食材を使い切りやすいです。",
    createdAt: "2026-07-12T09:45:00.000Z",
  },
  {
    id: "thread-303-post-3",
    threadId: "thread-303",
    no: 3,
    authorProfileId: "profile-me",
    displayName: "WGHコミュニティ運営",
    body: "組み合わせを曜日ではなく調理法で分ける案も便利でした。月曜は丼、火曜はスープのように枠だけ決め、店頭で手に入りやすい食材を三つ選ぶと、予定が変わっても調整しやすいです。",
    createdAt: "2026-07-12T11:30:00.000Z",
  },
];

const socialPosts: SocialPost[] = [
  {
    id: "social-204",
    authorProfileId: "profile-me",
    displayName: "世界政府ハブ運営",
    handle: "jkamma",
    identityMode: "account",
    body: "通知とメッセージ導線を先に固めてから、残りの画面を分割移植していきます。",
    createdAt: "2026-04-10T06:10:00.000Z",
    replyToPostId: null,
  },
  {
    id: "social-211",
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    handle: "yoru_observer",
    identityMode: "account",
    body: "スレッドでじっくり話し、Socialでは短く共有する今の構成はかなり見やすいです。",
    createdAt: "2026-04-10T06:25:00.000Z",
    replyToPostId: null,
  },
  {
    id: "social-219",
    authorProfileId: null,
    displayName: "匿名",
    identityMode: "guest",
    body: "右カラムに流れてくる情報量の感じが元 prototype らしくて好きです。",
    createdAt: "2026-04-10T06:40:00.000Z",
    replyToPostId: null,
  },
  {
    id: "social-222",
    authorProfileId: "profile-yoru",
    displayName: "Yoru Observer",
    handle: "yoru_observer",
    identityMode: "account",
    body: "返信通知が自動で出ると、導線の実感がかなり増します。",
    createdAt: "2026-04-10T06:45:00.000Z",
    replyToPostId: "social-204",
  },
];

const localMediaCardTestPosts: SocialPost[] = [
  {
    id: "curated-feed-release",
    authorProfileId: "profile-me",
    displayName: "J Kamma",
    handle: "jkamma",
    identityMode: "account",
    body: "フィードの密度と右列の表示を更新しました。引用リポストやリンクカードも、同じポストUIで読めるようになっています。",
    createdAt: "2026-07-16T05:40:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-night-walk",
    authorProfileId: "profile-yoru",
    displayName: "Yoru",
    handle: "yoru_observer",
    identityMode: "account",
    body: "雨上がりの道は、街灯の色が路面に残って写真を撮りやすい。今日はカメラを持たずに歩いたので、記憶だけ持ち帰りました。",
    createdAt: "2026-07-16T05:26:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-css-note",
    authorProfileId: "profile-rin",
    displayName: "Rin",
    handle: "rin_cipher",
    identityMode: "account",
    body: "狭いカラムでは、情報を消すより優先順位を見直すほうが効きます。名前、本文、反応の順番が崩れなければ、小さくても読みやすい。",
    createdAt: "2026-07-16T05:12:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-book",
    authorProfileId: "profile-noa",
    displayName: "Noa",
    handle: "noa_threads",
    identityMode: "account",
    body: "読み終えた本の感想は、結論より『どこで立ち止まったか』を残すと後から思い出しやすい。短いポストと長いスレッドを使い分けたいです。",
    createdAt: "2026-07-16T04:58:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-token-ranking",
    authorProfileId: "profile-me",
    displayName: "J Kamma",
    handle: "jkamma",
    identityMode: "account",
    body: "トークンランキングは公開ウォレットの保有量だけを比較します。プロフィール名は任意で、ランキングから個人情報を推測する用途には使いません。",
    createdAt: "2026-07-16T04:44:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-reply",
    authorProfileId: "profile-yoru",
    displayName: "Yoru",
    handle: "yoru_observer",
    identityMode: "account",
    body: "ランキングの対象トークンを利用者が指定できるのが分かりやすいです。ネットワーク名も一緒に見えると間違えにくそう。",
    createdAt: "2026-07-16T04:36:00.000Z",
    replyToPostId: "curated-feed-token-ranking",
  },
  {
    id: "curated-feed-question",
    authorProfileId: null,
    displayName: "通りすがり",
    identityMode: "guest",
    body: "おすすめフィードとフォローフィードを切り替えても、読んでいた位置を覚えてくれるとうれしいです。",
    createdAt: "2026-07-16T04:20:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-quote",
    authorProfileId: "profile-rin",
    displayName: "Rin",
    handle: "rin_cipher",
    identityMode: "account",
    body: "『どこで立ち止まったか』を残す、という書き方は制作記録にも使えそうです。完成品だけでなく判断の跡も共有したい。",
    createdAt: "2026-07-16T04:08:00.000Z",
    replyToPostId: null,
    quoteOfTargetType: "social_post",
    quoteOfTargetId: "curated-feed-book",
  },
  {
    id: "curated-feed-video",
    authorProfileId: "profile-rin",
    displayName: "Rin",
    handle: "rin_cipher",
    identityMode: "account",
    body: "埋め込みプレーヤーの操作感を確認するための動画です。URLはカード表示時に本文から省略されます。\nhttps://www.youtube.com/watch?v=M7lc1UVf-VE",
    createdAt: "2026-07-16T03:52:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-link",
    authorProfileId: "profile-noa",
    displayName: "Noa",
    handle: "noa_threads",
    identityMode: "account",
    body: "長文を書く前の下書き整理に使っているサービス。リンクカードの情報量もこのくらいが読みやすいです。\nhttps://note.com/",
    createdAt: "2026-07-16T03:38:00.000Z",
    replyToPostId: null,
  },
  {
    id: "curated-feed-repost",
    authorProfileId: "profile-noa",
    displayName: "Noa",
    handle: "noa_threads",
    identityMode: "account",
    body: "",
    createdAt: "2026-07-16T03:24:00.000Z",
    replyToPostId: null,
    repostOfTargetType: "social_post",
    repostOfTargetId: "curated-feed-css-note",
  },
];

const localMediaCardTestPostIds = new Set(
  localMediaCardTestPosts.map((post) => post.id),
);

const obsoleteLocalMockPostIds = new Set([
  "local-media-youtube",
  "local-media-vimeo",
  "local-media-niconico",
  "local-media-spotify",
  "local-media-generic-link",
]);

const tokenBalances: Record<string, TokenBalanceEntry[]> = {
  "profile-me": [
    { symbol: "WG", amount: 12000, network: "Development" },
    { symbol: "CAPS", amount: 2800, network: "Development" },
    { symbol: "REP", amount: 4, network: "Development" },
    { symbol: "ETH", amount: 3.8, network: "Ethereum" },
  ],
  "profile-yoru": [
    { symbol: "WG", amount: 8300, network: "Development" },
    { symbol: "ETH", amount: 1.4, network: "Ethereum" },
  ],
  "profile-rin": [
    { symbol: "WG", amount: 5100, network: "Development" },
    { symbol: "CAPS", amount: 4200, network: "Development" },
    { symbol: "REP", amount: 2, network: "Development" },
    { symbol: "ETH", amount: 0.8, network: "Ethereum" },
  ],
  "profile-noa": [
    { symbol: "WG", amount: 4200, network: "Development" },
    { symbol: "CAPS", amount: 1600, network: "Development" },
    { symbol: "REP", amount: 6, network: "Development" },
    { symbol: "ETH", amount: 0.4, network: "Ethereum" },
  ],
};

const tokenRankings: TokenRankingDefinition[] = [
  {
    id: "token-ranking-wg",
    title: "WG保有量ランキング",
    symbol: "WG",
    network: "Development",
    description: "開発用WG残高のランキングです。",
    createdByProfileId: "profile-me",
    createdAt: "2026-04-10T07:00:00.000Z",
  },
  {
    id: "token-ranking-eth",
    title: "ETH保有量ランキング",
    symbol: "ETH",
    network: "Ethereum",
    description: "開発用ETH残高のランキングです。",
    createdByProfileId: "profile-me",
    createdAt: "2026-04-10T07:05:00.000Z",
  },
];

const lists: UserList[] = [
  {
    id: "list-public",
    name: "リスト1",
    description: "よく見るプロフィールとスレッドをまとめたモックリストです。",
    visibility: "public",
    order: 0,
    threadIds: ["thread-88"],
    profileIds: ["profile-me", "profile-yoru"],
  },
  {
    id: "list-private",
    name: "リスト2",
    description: "あとで確認したいプロフィールをまとめたモックリストです。",
    visibility: "private",
    order: 1,
    threadIds: ["thread-104"],
    profileIds: ["profile-rin"],
  },
];

const legacyMockListIds = new Set([
  "list-public",
  "list-private",
  "list-idea",
  "list-build",
]);

const bookmarks: BookmarkItem[] = [
  {
    id: "bookmark-thread-88",
    targetType: "thread",
    targetId: "thread-88",
    note: "導線設計のベースになるスレ",
  },
  {
    id: "bookmark-social-204",
    targetType: "social_post",
    targetId: "social-204",
    note: "通知導線の起点ポスト",
  },
  {
    id: "bookmark-thread-post-88-1",
    targetType: "thread_post",
    targetId: "thread-88-post-1",
    note: "鍵確認フロー担当",
  },
];

const reactions: Reaction[] = [];
const threadTracking: ThreadTracking[] = [];
const threadPostRevisions: ThreadPostRevision[] = [];
const threadPostReports: ThreadPostReport[] = [];
const threadUserControls: ThreadUserControl[] = [];

const conversations: MessageConversation[] = [
  {
    id: "conv-yoru",
    participantIds: ["profile-me", "profile-yoru"],
    isE2ee: true,
    verificationStatus: "verified",
    fingerprint: "5A:19:9F:00:72:AB",
    unreadCountByProfileId: {
      "profile-me": 0,
      "profile-yoru": 1,
    },
    lastMessageAt: "2026-04-10T06:50:00.000Z",
  },
  {
    id: "conv-rin",
    participantIds: ["profile-me", "profile-rin"],
    isE2ee: true,
    verificationStatus: "unverified",
    fingerprint: "DE:44:77:B2:01:F9",
    unreadCountByProfileId: {
      "profile-me": 2,
      "profile-rin": 0,
    },
    lastMessageAt: "2026-04-10T03:05:00.000Z",
  },
];

const messages: DirectMessage[] = [
  {
    id: "msg-1",
    conversationId: "conv-yoru",
    senderProfileId: "profile-yoru",
    encryptedPayload: "sealed::7f2c-yoru-bootstrap",
    previewText: "通知自動発火の流れ、先に UI で見えるようにしておきました。",
    encryptionVersion: "proto-e2ee-v1",
    encryptionState: "sealed",
    createdAt: "2026-04-10T06:31:00.000Z",
  },
  {
    id: "msg-2",
    conversationId: "conv-yoru",
    senderProfileId: "profile-me",
    encryptedPayload: "sealed::1d93-reply-path",
    previewText: "ありがとう。返信とフォロー通知を API に切り出す予定です。",
    encryptionVersion: "proto-e2ee-v1",
    encryptionState: "sealed",
    createdAt: "2026-04-10T06:50:00.000Z",
  },
  {
    id: "msg-3",
    conversationId: "conv-rin",
    senderProfileId: "profile-rin",
    encryptedPayload: "sealed::ab31-keycheck",
    previewText:
      "鍵確認フローは UI だけ先に入れて、実暗号化は後段で積みたいです。",
    encryptionVersion: "proto-e2ee-v1",
    encryptionState: "sealed",
    createdAt: "2026-04-10T02:58:00.000Z",
  },
  {
    id: "msg-4",
    conversationId: "conv-rin",
    senderProfileId: "profile-rin",
    encryptedPayload: "draft::pending-fingerprint",
    previewText: "未確認状態のままでも会話開始できる設計に寄せています。",
    encryptionVersion: "proto-e2ee-v1",
    encryptionState: "draft",
    createdAt: "2026-04-10T03:05:00.000Z",
  },
];

interface PersistedState {
  profiles: Profile[];
  communities: Community[];
  communityMemberships: CommunityMembership[];
  communityChannels: CommunityChannel[];
  communityChannelMessages: CommunityChannelMessage[];
  communityChannelReactions: CommunityChannelReaction[];
  communityChannelReadStates: CommunityChannelReadState[];
  communityMessageReports: CommunityMessageReport[];
  communityTokens: CommunityTokenDefinition[];
  communityGuideDirectories: CommunityGuideDirectory[];
  communityGuidePages: CommunityGuidePage[];
  communityGuideProposals: CommunityGuideProposal[];
  communityGuideReviews: CommunityGuideReview[];
  communityGovernanceProposals: CommunityGovernanceProposal[];
  communityGovernanceVotes: CommunityGovernanceVote[];
  notifications: Notification[];
  follows: FollowRelation[];
  boards: Board[];
  threads: ThreadSummary[];
  threadTracking: ThreadTracking[];
  threadPosts: ThreadPost[];
  threadPostRevisions: ThreadPostRevision[];
  threadPostReports: ThreadPostReport[];
  threadUserControls: ThreadUserControl[];
  socialPosts: SocialPost[];
  tokenBalances: Record<string, TokenBalanceEntry[]>;
  tokenRankings: TokenRankingDefinition[];
  lists: UserList[];
  bookmarks: BookmarkItem[];
  reactions: Reaction[];
  conversations: MessageConversation[];
  messages: DirectMessage[];
}

function cloneSeedState(): PersistedState {
  return {
    profiles: structuredClone(profiles),
    communities: structuredClone(communities),
    communityMemberships: structuredClone(communityMemberships),
    communityChannels: structuredClone(communityChannels),
    communityChannelMessages: structuredClone(communityChannelMessages),
    communityChannelReactions: structuredClone(communityChannelReactions),
    communityChannelReadStates: structuredClone(communityChannelReadStates),
    communityMessageReports: structuredClone(communityMessageReports),
    communityTokens: structuredClone(communityTokens),
    communityGuideDirectories: structuredClone(communityGuideDirectories),
    communityGuidePages: structuredClone(communityGuidePages),
    communityGuideProposals: structuredClone(communityGuideProposals),
    communityGuideReviews: structuredClone(communityGuideReviews),
    communityGovernanceProposals: structuredClone(communityGovernanceProposals),
    communityGovernanceVotes: structuredClone(communityGovernanceVotes),
    notifications: structuredClone(notifications),
    follows: structuredClone(follows),
    boards: structuredClone(boards),
    threads: structuredClone(threads),
    threadTracking: structuredClone(threadTracking),
    threadPosts: structuredClone(threadPosts),
    threadPostRevisions: structuredClone(threadPostRevisions),
    threadPostReports: structuredClone(threadPostReports),
    threadUserControls: structuredClone(threadUserControls),
    socialPosts: structuredClone(socialPosts),
    tokenBalances: structuredClone(tokenBalances),
    tokenRankings: structuredClone(tokenRankings),
    lists: structuredClone(lists),
    bookmarks: structuredClone(bookmarks),
    reactions: structuredClone(reactions),
    conversations: structuredClone(conversations),
    messages: structuredClone(messages),
  };
}

function replaceArrayContents<T>(target: T[], next: T[]) {
  target.splice(0, target.length, ...next);
}

function replaceRecordContents<T>(
  target: Record<string, T>,
  next: Record<string, T>,
) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, next);
}

function normalizeLists(nextLists: UserList[]) {
  return nextLists.map((list, index) => ({
    ...list,
    visibility: list.visibility ?? "private",
    order: list.order ?? index,
  }));
}

function withCuratedMockLists(nextLists: UserList[]) {
  const normalized = normalizeLists(nextLists);
  if (process.env.NODE_ENV === "production") return normalized;
  const customLists = normalized.filter(
    (list) => !legacyMockListIds.has(list.id),
  );
  return normalizeLists([...structuredClone(lists), ...customLists]);
}

function withLocalMediaCardTestPosts(posts: SocialPost[]) {
  const withoutTestPosts = posts.filter((post) => {
    if (
      localMediaCardTestPostIds.has(post.id) ||
      obsoleteLocalMockPostIds.has(post.id)
    )
      return false;
    const body = post.body.trim();
    if (/^Repost:\s+/i.test(body) || /^(?:a|test|smoke test post)$/i.test(body))
      return false;
    if (!body && post.repostOfTargetId) return false;
    return true;
  });
  return process.env.NODE_ENV === "production"
    ? withoutTestPosts
    : [...structuredClone(localMediaCardTestPosts), ...withoutTestPosts];
}

/*
 * Workers has no filesystem, so mkdirSync throws "operation not permitted"
 * there and takes the whole response down with it. /search was returning 500
 * on staging for exactly this reason: it reaches a code path that mutates this
 * store, and the write is fatal rather than merely useless.
 *
 * This store is a development fixture. On Workers the real data comes from D1,
 * so there is nothing to persist and skipping is the correct behaviour, not a
 * workaround.
 */
function persistState() {
  if (process.env.CLOUDFLARE_RUNTIME === "workers") return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(getRawState(), null, 2);
  fs.writeFileSync(DATA_FILE, payload, "utf8");
}

function getRawState(): PersistedState {
  return {
    profiles,
    communities,
    communityMemberships,
    communityChannels,
    communityChannelMessages,
    communityChannelReactions,
    communityChannelReadStates,
    communityMessageReports,
    communityTokens,
    communityGuideDirectories,
    communityGuidePages,
    communityGuideProposals,
    communityGuideReviews,
    communityGovernanceProposals,
    communityGovernanceVotes,
    notifications,
    follows,
    boards,
    threads,
    threadTracking,
    threadPosts,
    threadPostRevisions,
    threadPostReports,
    threadUserControls,
    socialPosts,
    tokenBalances,
    tokenRankings,
    lists,
    bookmarks,
    reactions,
    conversations,
    messages,
  };
}

function mergeCuratedThreadSeed(
  storedThreads: ThreadSummary[],
  storedPosts: ThreadPost[],
  seedThreads: ThreadSummary[],
  seedPosts: ThreadPost[],
) {
  const seedThreadIds = new Set(seedThreads.map((thread) => thread.id));
  const seedThreadById = new Map(
    seedThreads.map((thread) => [thread.id, thread]),
  );
  const seedPostById = new Map(seedPosts.map((post) => [post.id, post]));
  const mergedPosts = storedPosts.map(
    (post) => seedPostById.get(post.id) ?? post,
  );
  const storedPostIds = new Set(mergedPosts.map((post) => post.id));
  for (const post of seedPosts)
    if (!storedPostIds.has(post.id)) mergedPosts.push(post);

  const mergedThreads = storedThreads.map(
    (thread) => seedThreadById.get(thread.id) ?? thread,
  );
  const storedThreadIds = new Set(mergedThreads.map((thread) => thread.id));
  for (const thread of seedThreads)
    if (!storedThreadIds.has(thread.id)) mergedThreads.push(thread);

  return {
    threads: mergedThreads.map((thread) => {
      if (!seedThreadIds.has(thread.id)) return thread;
      const posts = mergedPosts.filter((post) => post.threadId === thread.id);
      const updatedAt = posts.reduce(
        (latest, post) => (post.createdAt > latest ? post.createdAt : latest),
        thread.updatedAt,
      );
      return { ...thread, postCount: posts.length, updatedAt };
    }),
    posts: mergedPosts,
  };
}

function appendMissingSeedRecords<T>(
  target: T[],
  seed: T[],
  getKey: (value: T) => string,
) {
  const existingKeys = new Set(target.map(getKey));
  let changed = false;

  for (const value of seed) {
    const key = getKey(value);
    if (existingKeys.has(key)) continue;
    target.push(structuredClone(value));
    existingKeys.add(key);
    changed = true;
  }

  return changed;
}

const additionalDiscoveryCommunityIds = new Set([
  "community-indie-games",
  "community-web-ai",
  "community-books-cinema",
  "community-night-photo",
  "community-music-makers",
  "community-language-exchange",
]);

function ensureAdditionalDiscoveryCommunitySeeds(seed: PersistedState) {
  const changes = [
    appendMissingSeedRecords(
      communities,
      seed.communities.filter((community) =>
        additionalDiscoveryCommunityIds.has(community.id),
      ),
      (community) => community.id,
    ),
    appendMissingSeedRecords(
      communityMemberships,
      seed.communityMemberships.filter((membership) =>
        additionalDiscoveryCommunityIds.has(membership.communityId),
      ),
      (membership) => `${membership.communityId}:${membership.profileId}`,
    ),
    appendMissingSeedRecords(
      communityChannels,
      seed.communityChannels.filter((channel) =>
        additionalDiscoveryCommunityIds.has(channel.communityId),
      ),
      (channel) => channel.id,
    ),
  ];
  return changes.some(Boolean);
}

function ensureFallout4TestCommunitySeed(seed: PersistedState) {
  const communityId = "community-fallout4";
  const channelIds = new Set(
    seed.communityChannels
      .filter((channel) => channel.communityId === communityId)
      .map((channel) => channel.id),
  );
  const proposalIds = new Set(
    seed.communityGuideProposals
      .filter((proposal) => proposal.communityId === communityId)
      .map((proposal) => proposal.id),
  );
  const governanceProposalIds = new Set(
    seed.communityGovernanceProposals
      .filter((proposal) => proposal.communityId === communityId)
      .map((proposal) => proposal.id),
  );

  const changes = [
    appendMissingSeedRecords(
      communities,
      seed.communities.filter((community) => community.id === communityId),
      (community) => community.id,
    ),
    appendMissingSeedRecords(
      communityMemberships,
      seed.communityMemberships.filter(
        (membership) => membership.communityId === communityId,
      ),
      (membership) => `${membership.communityId}:${membership.profileId}`,
    ),
    appendMissingSeedRecords(
      communityChannels,
      seed.communityChannels.filter(
        (channel) => channel.communityId === communityId,
      ),
      (channel) => channel.id,
    ),
    appendMissingSeedRecords(
      communityChannelMessages,
      seed.communityChannelMessages.filter((message) =>
        channelIds.has(message.channelId),
      ),
      (message) => message.id,
    ),
    appendMissingSeedRecords(
      communityTokens,
      seed.communityTokens.filter((token) => token.communityId === communityId),
      (token) => token.id,
    ),
    appendMissingSeedRecords(
      communityGuideDirectories,
      seed.communityGuideDirectories.filter(
        (directory) => directory.communityId === communityId,
      ),
      (directory) => directory.id,
    ),
    appendMissingSeedRecords(
      communityGuidePages,
      seed.communityGuidePages.filter(
        (page) => page.communityId === communityId,
      ),
      (page) => page.id,
    ),
    appendMissingSeedRecords(
      communityGuideProposals,
      seed.communityGuideProposals.filter(
        (proposal) => proposal.communityId === communityId,
      ),
      (proposal) => proposal.id,
    ),
    appendMissingSeedRecords(
      communityGuideReviews,
      seed.communityGuideReviews.filter((review) =>
        proposalIds.has(review.proposalId),
      ),
      (review) => review.id,
    ),
    appendMissingSeedRecords(
      communityGovernanceProposals,
      seed.communityGovernanceProposals.filter(
        (proposal) => proposal.communityId === communityId,
      ),
      (proposal) => proposal.id,
    ),
    appendMissingSeedRecords(
      communityGovernanceVotes,
      seed.communityGovernanceVotes.filter((vote) =>
        governanceProposalIds.has(vote.proposalId),
      ),
      (vote) => `${vote.proposalId}:${vote.profileId}`,
    ),
  ];

  const storedCommunity = communities.find(
    (community) => community.id === communityId,
  );
  const seedCommunity = seed.communities.find(
    (community) => community.id === communityId,
  );
  if (
    storedCommunity &&
    seedCommunity?.governanceMode &&
    !storedCommunity.governanceMode
  ) {
    storedCommunity.governanceMode = seedCommunity.governanceMode;
    changes.push(true);
  }
  if (storedCommunity && seedCommunity) {
    for (const key of [
      "governanceVotingStrategy",
      "governanceTokenId",
      "governanceTokensPerVote",
      "governanceVoteCap",
    ] as const) {
      if (
        storedCommunity[key] !== undefined ||
        seedCommunity[key] === undefined
      )
        continue;
      Object.assign(storedCommunity, { [key]: seedCommunity[key] });
      changes.push(true);
    }
    const storedRules = storedCommunity.governanceTokenRules ?? [];
    const storedRuleIds = new Set(storedRules.map((rule) => rule.tokenId));
    const missingRules = (seedCommunity.governanceTokenRules ?? []).filter(
      (rule) => !storedRuleIds.has(rule.tokenId),
    );
    if (missingRules.length > 0) {
      storedCommunity.governanceTokenRules = [
        ...storedRules,
        ...structuredClone(missingRules),
      ];
      changes.push(true);
    }
  }
  const falloutTokenSymbols = new Set(
    seed.communityTokens
      .filter((token) => token.communityId === communityId)
      .map((token) => token.symbol.toUpperCase()),
  );
  for (const [profileId, seedBalances] of Object.entries(seed.tokenBalances)) {
    const originalBalances = tokenBalances[profileId] ?? [];
    const storedBalances: TokenBalanceEntry[] = [];
    for (const balance of originalBalances) {
      const symbol = balance.symbol.toUpperCase();
      const existingIndex = storedBalances.findIndex(
        (entry) =>
          entry.symbol.toUpperCase() === symbol &&
          (!entry.network ||
            !balance.network ||
            entry.network.toLowerCase() === balance.network.toLowerCase()),
      );
      if (existingIndex < 0 || !falloutTokenSymbols.has(symbol)) {
        storedBalances.push(balance);
        continue;
      }
      if (!storedBalances[existingIndex]?.network && balance.network) {
        storedBalances[existingIndex] = balance;
      }
    }
    if (storedBalances.length !== originalBalances.length) changes.push(true);
    for (const balance of seedBalances) {
      if (!falloutTokenSymbols.has(balance.symbol.toUpperCase())) continue;
      const exists = storedBalances.some(
        (entry) =>
          entry.symbol.toUpperCase() === balance.symbol.toUpperCase() &&
          (!entry.network ||
            !balance.network ||
            entry.network.toLowerCase() === balance.network.toLowerCase()),
      );
      if (exists) continue;
      storedBalances.push(structuredClone(balance));
      changes.push(true);
    }
    tokenBalances[profileId] = storedBalances;
  }
  for (const message of communityChannelMessages.filter((entry) =>
    channelIds.has(entry.channelId),
  )) {
    if (!message.body.includes("攻略PR")) continue;
    message.body = message.body.replaceAll("攻略PR", "編集提案");
    changes.push(true);
  }
  for (const page of communityGuidePages.filter(
    (entry) => entry.communityId === communityId,
  )) {
    if (!page.body.includes("攻略PR") && !page.body.includes("変更提案"))
      continue;
    page.body = page.body
      .replaceAll("攻略PR", "編集提案")
      .replaceAll("変更提案", "編集提案");
    changes.push(true);
  }
  for (const proposal of communityGovernanceProposals.filter(
    (entry) => entry.communityId === communityId,
  )) {
    const nextTitle = proposal.title.replaceAll("攻略PR", "編集提案");
    const nextBody = proposal.body.replaceAll("攻略PR", "編集提案");
    if (nextTitle === proposal.title && nextBody === proposal.body) continue;
    proposal.title = nextTitle;
    proposal.body = nextBody;
    changes.push(true);
  }

  for (const seedPage of seed.communityGuidePages.filter(
    (page) => page.communityId === communityId,
  )) {
    const storedPage = communityGuidePages.find(
      (page) => page.id === seedPage.id,
    );
    if (storedPage && !storedPage.directoryId && seedPage.directoryId) {
      storedPage.directoryId = seedPage.directoryId;
      changes.push(true);
    }
  }
  for (const seedProposal of seed.communityGuideProposals.filter(
    (proposal) => proposal.communityId === communityId,
  )) {
    const storedProposal = communityGuideProposals.find(
      (proposal) => proposal.id === seedProposal.id,
    );
    if (
      storedProposal &&
      !storedProposal.proposedDirectoryId &&
      seedProposal.proposedDirectoryId
    ) {
      storedProposal.proposedDirectoryId = seedProposal.proposedDirectoryId;
      changes.push(true);
    }
  }

  return changes.some(Boolean);
}

function ensureSeedCommunityImages(seed: PersistedState) {
  const imageUrlsById = new Map(
    seed.communities.flatMap((community) =>
      community.imageUrl ? ([[community.id, community.imageUrl]] as const) : [],
    ),
  );
  let changed = false;

  for (const community of communities) {
    const imageUrl = imageUrlsById.get(community.id);
    if (!imageUrl) continue;
    const legacyPngUrl = imageUrl.replace(/\.webp$/, ".png");
    if (community.imageUrl && community.imageUrl !== legacyPngUrl) continue;
    if (community.imageUrl === imageUrl) continue;
    community.imageUrl = imageUrl;
    changed = true;
  }

  return changed;
}

function ensureSeedCommunityKnowledgeLabels(seed: PersistedState) {
  const seedById = new Map(
    seed.communities.map((community) => [community.id, community]),
  );
  let changed = false;
  for (const community of communities) {
    const seeded = seedById.get(community.id);
    if (!seeded) continue;
    if (!community.knowledgeLabel && seeded.knowledgeLabel) {
      community.knowledgeLabel = seeded.knowledgeLabel;
      changed = true;
    }
    if (!community.knowledgeDescription && seeded.knowledgeDescription) {
      community.knowledgeDescription = seeded.knowledgeDescription;
      changed = true;
    }
  }
  return changed;
}

function initializePersistence() {
  if (!fs.existsSync(DATA_FILE)) {
    replaceArrayContents(boards, buildBoardCatalog());
    replaceArrayContents(threads, normalizeThreads(threads));
    syncBoardThreadCounts(boards, threads);
    replaceArrayContents(socialPosts, withLocalMediaCardTestPosts(socialPosts));
    persistState();
    return;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8"),
    ) as Partial<PersistedState>;
    const fallback = cloneSeedState();
    const curatedBbs = mergeCuratedThreadSeed(
      normalizeThreads(parsed.threads ?? fallback.threads),
      parsed.threadPosts ?? fallback.threadPosts,
      normalizeThreads(fallback.threads),
      fallback.threadPosts,
    );

    replaceArrayContents(profiles, parsed.profiles ?? fallback.profiles);
    const jkammaProfile = profiles.find(
      (profile) => profile.handle === "jkamma",
    );
    if (jkammaProfile) {
      jkammaProfile.displayName = "J Kamma";
      jkammaProfile.bio = "JKammaからのお知らせやおすすめを投稿します。";
      jkammaProfile.avatarUrl = "/jkamma-profile.avif";
    }
    replaceArrayContents(
      communities,
      parsed.communities ?? fallback.communities,
    );
    replaceArrayContents(
      communityMemberships,
      parsed.communityMemberships ?? fallback.communityMemberships,
    );
    replaceArrayContents(
      communityChannels,
      parsed.communityChannels ?? fallback.communityChannels,
    );
    replaceArrayContents(
      communityChannelMessages,
      parsed.communityChannelMessages ?? fallback.communityChannelMessages,
    );
    replaceArrayContents(
      communityChannelReactions,
      parsed.communityChannelReactions ?? fallback.communityChannelReactions,
    );
    replaceArrayContents(
      communityChannelReadStates,
      parsed.communityChannelReadStates ?? fallback.communityChannelReadStates,
    );
    replaceArrayContents(
      communityMessageReports,
      parsed.communityMessageReports ?? fallback.communityMessageReports,
    );
    replaceArrayContents(
      communityTokens,
      parsed.communityTokens ?? fallback.communityTokens,
    );
    replaceArrayContents(
      communityGuideDirectories,
      parsed.communityGuideDirectories ?? fallback.communityGuideDirectories,
    );
    replaceArrayContents(
      communityGuidePages,
      parsed.communityGuidePages ?? fallback.communityGuidePages,
    );
    replaceArrayContents(
      communityGuideProposals,
      parsed.communityGuideProposals ?? fallback.communityGuideProposals,
    );
    replaceArrayContents(
      communityGuideReviews,
      parsed.communityGuideReviews ?? fallback.communityGuideReviews,
    );
    replaceArrayContents(
      communityGovernanceProposals,
      parsed.communityGovernanceProposals ??
        fallback.communityGovernanceProposals,
    );
    replaceArrayContents(
      communityGovernanceVotes,
      parsed.communityGovernanceVotes ?? fallback.communityGovernanceVotes,
    );
    replaceArrayContents(
      notifications,
      parsed.notifications ?? fallback.notifications,
    );
    replaceArrayContents(follows, parsed.follows ?? fallback.follows);
    replaceArrayContents(boards, buildBoardCatalog());
    replaceArrayContents(threads, curatedBbs.threads);
    replaceArrayContents(
      threadTracking,
      parsed.threadTracking ?? fallback.threadTracking,
    );
    replaceArrayContents(threadPosts, curatedBbs.posts);
    replaceArrayContents(
      threadPostRevisions,
      parsed.threadPostRevisions ?? fallback.threadPostRevisions,
    );
    replaceArrayContents(
      threadPostReports,
      parsed.threadPostReports ?? fallback.threadPostReports,
    );
    replaceArrayContents(
      threadUserControls,
      parsed.threadUserControls ?? fallback.threadUserControls,
    );
    replaceArrayContents(
      socialPosts,
      withLocalMediaCardTestPosts(parsed.socialPosts ?? fallback.socialPosts),
    );
    replaceRecordContents(
      tokenBalances,
      parsed.tokenBalances ?? fallback.tokenBalances,
    );
    replaceArrayContents(
      tokenRankings,
      parsed.tokenRankings ?? fallback.tokenRankings,
    );
    replaceArrayContents(
      lists,
      withCuratedMockLists(parsed.lists ?? fallback.lists),
    );
    replaceArrayContents(bookmarks, parsed.bookmarks ?? fallback.bookmarks);
    replaceArrayContents(reactions, parsed.reactions ?? fallback.reactions);
    replaceArrayContents(
      conversations,
      parsed.conversations ?? fallback.conversations,
    );
    replaceArrayContents(messages, parsed.messages ?? fallback.messages);
    syncBoardThreadCounts(boards, threads);
    const seededFallout4 = ensureFallout4TestCommunitySeed(fallback);
    const seededDiscoveryCommunities =
      ensureAdditionalDiscoveryCommunitySeeds(fallback);
    const seededCommunityImages = ensureSeedCommunityImages(fallback);
    const seededKnowledgeLabels = ensureSeedCommunityKnowledgeLabels(fallback);
    if (
      seededFallout4 ||
      seededDiscoveryCommunities ||
      seededCommunityImages ||
      seededKnowledgeLabels
    )
      persistState();
  } catch {
    const fallback = cloneSeedState();
    replaceArrayContents(profiles, fallback.profiles);
    replaceArrayContents(communities, fallback.communities);
    replaceArrayContents(communityMemberships, fallback.communityMemberships);
    replaceArrayContents(communityChannels, fallback.communityChannels);
    replaceArrayContents(
      communityChannelMessages,
      fallback.communityChannelMessages,
    );
    replaceArrayContents(
      communityChannelReactions,
      fallback.communityChannelReactions,
    );
    replaceArrayContents(
      communityChannelReadStates,
      fallback.communityChannelReadStates,
    );
    replaceArrayContents(
      communityMessageReports,
      fallback.communityMessageReports,
    );
    replaceArrayContents(communityTokens, fallback.communityTokens);
    replaceArrayContents(
      communityGuideDirectories,
      fallback.communityGuideDirectories,
    );
    replaceArrayContents(communityGuidePages, fallback.communityGuidePages);
    replaceArrayContents(
      communityGuideProposals,
      fallback.communityGuideProposals,
    );
    replaceArrayContents(communityGuideReviews, fallback.communityGuideReviews);
    replaceArrayContents(
      communityGovernanceProposals,
      fallback.communityGovernanceProposals,
    );
    replaceArrayContents(
      communityGovernanceVotes,
      fallback.communityGovernanceVotes,
    );
    replaceArrayContents(notifications, fallback.notifications);
    replaceArrayContents(follows, fallback.follows);
    replaceArrayContents(boards, buildBoardCatalog());
    replaceArrayContents(threads, normalizeThreads(fallback.threads));
    replaceArrayContents(threadTracking, fallback.threadTracking);
    replaceArrayContents(threadPosts, fallback.threadPosts);
    replaceArrayContents(threadPostRevisions, fallback.threadPostRevisions);
    replaceArrayContents(threadPostReports, fallback.threadPostReports);
    replaceArrayContents(threadUserControls, fallback.threadUserControls);
    replaceArrayContents(
      socialPosts,
      withLocalMediaCardTestPosts(fallback.socialPosts),
    );
    replaceRecordContents(tokenBalances, fallback.tokenBalances);
    replaceArrayContents(tokenRankings, fallback.tokenRankings);
    replaceArrayContents(lists, withCuratedMockLists(fallback.lists));
    replaceArrayContents(bookmarks, fallback.bookmarks);
    replaceArrayContents(reactions, fallback.reactions);
    replaceArrayContents(conversations, fallback.conversations);
    replaceArrayContents(messages, fallback.messages);
    syncBoardThreadCounts(boards, threads);
    persistState();
  }
}

initializePersistence();

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function notifyIfExternal(input: {
  receiverProfileId?: string | null;
  actorProfileId?: string | null;
  type: Notification["type"];
  targetType: Notification["targetType"];
  targetId: string;
  text: string;
  createdAt?: string;
}) {
  if (
    !input.receiverProfileId ||
    input.receiverProfileId === input.actorProfileId ||
    isThreadAuthorBlocked(input.receiverProfileId, input.actorProfileId ?? null)
  ) {
    return;
  }

  notifications.unshift({
    id: makeId("notif"),
    receiverProfileId: input.receiverProfileId,
    actorProfileId: input.actorProfileId ?? null,
    type: input.type,
    targetType: input.targetType,
    targetId: input.targetId,
    text: input.text,
    isRead: false,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

function getEngagementTargetOwner(
  targetType: EngagementTargetType,
  targetId: string,
): string | null {
  if (targetType === "social_post") {
    return getSocialPostById(targetId)?.authorProfileId ?? null;
  }

  if (targetType === "thread_post")
    return getThreadPostById(targetId)?.authorProfileId ?? null;
  return null;
}

function requireCommunityMessageEngagementTarget(
  messageId: string,
  profileId: string,
) {
  const message = communityChannelMessages.find(
    (entry) => entry.id === messageId,
  );
  const channel = message
    ? communityChannels.find((entry) => entry.id === message.channelId)
    : undefined;
  const membership = channel
    ? communityMemberships.find(
        (entry) =>
          entry.communityId === channel.communityId &&
          entry.profileId === profileId,
      )
    : undefined;
  if (!message || !channel)
    throw new Error("Community message does not exist.");
  if (!membership || (membership.status ?? "active") !== "active") {
    throw new Error("Join the community before interacting with this post.");
  }
}

function currentProfile(): Profile {
  const profile = profiles.find((entry) => entry.isCurrentUser);

  if (!profile) {
    throw new Error("Current profile is not configured.");
  }

  return profile;
}

export function getProfiles(): Profile[] {
  return [...profiles];
}

export function getCommunities(): Community[] {
  return [...communities].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function getActiveCommunityActor(communityId: string) {
  const actor = currentProfile();
  const membership = communityMemberships.find(
    (entry) =>
      entry.communityId === communityId && entry.profileId === actor.id,
  );
  if (!membership || (membership.status ?? "active") !== "active") {
    throw new Error("Join the community before editing its guide.");
  }
  return { actor, membership };
}

export function getCommunityGuidePages(
  communityId?: string,
): CommunityGuidePage[] {
  return communityGuidePages
    .filter((page) => !communityId || page.communityId === communityId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((page) => ({ ...page }));
}

export function getCommunityGuideDirectories(
  communityId?: string,
): CommunityGuideDirectory[] {
  return communityGuideDirectories
    .filter(
      (directory) => !communityId || directory.communityId === communityId,
    )
    .sort(
      (left, right) =>
        left.position - right.position ||
        left.createdAt.localeCompare(right.createdAt),
    )
    .map((directory) => ({ ...directory }));
}

export function getCommunityGuideProposals(
  communityId?: string,
): CommunityGuideProposal[] {
  return communityGuideProposals
    .filter((proposal) => !communityId || proposal.communityId === communityId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((proposal) => ({ ...proposal }));
}

export function getCommunityGuideReviews(
  proposalId?: string,
): CommunityGuideReview[] {
  return communityGuideReviews
    .filter((review) => !proposalId || review.proposalId === proposalId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((review) => ({ ...review }));
}

export function getCommunityGovernanceProposals(
  communityId?: string,
): CommunityGovernanceProposal[] {
  return communityGovernanceProposals
    .filter((proposal) => !communityId || proposal.communityId === communityId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((proposal) => ({ ...proposal }));
}

export function getCommunityGovernanceVotes(
  proposalId?: string,
): CommunityGovernanceVote[] {
  return communityGovernanceVotes
    .filter((vote) => !proposalId || vote.proposalId === proposalId)
    .map((vote) => ({ ...vote }));
}

export function updateCommunityGovernanceSettings(input: {
  communityId: string;
  votingStrategy: "one_member_one_vote" | "token_weighted" | "token_capped";
  governanceTokenId?: string | null;
  tokensPerVote?: number;
  tokenRules?: Array<{
    tokenId: string;
    tokensPerVote: number;
    weight: number;
  }>;
  voteWeightCap?: number | null;
}) {
  const { membership } = getActiveCommunityActor(input.communityId);
  if (membership.role !== "owner") {
    throw new Error("DAO投票設定を変更できるのはオーナーだけです。");
  }
  const community = communities.find((entry) => entry.id === input.communityId);
  if (!community || community.governanceMode !== "dao") {
    throw new Error("このコミュニティではDAO運営が有効ではありません。");
  }
  const tokenRules =
    input.votingStrategy === "one_member_one_vote"
      ? []
      : (input.tokenRules?.length
          ? input.tokenRules
          : input.governanceTokenId
            ? [
                {
                  tokenId: input.governanceTokenId,
                  tokensPerVote: Number(input.tokensPerVote ?? 1),
                  weight: 1,
                },
              ]
            : []);
  if (
    input.votingStrategy !== "one_member_one_vote" &&
    tokenRules.length < 1
  ) {
    throw new Error("投票トークンを1個以上選択してください。");
  }
  if (new Set(tokenRules.map((rule) => rule.tokenId)).size !== tokenRules.length) {
    throw new Error("同じ投票トークンを重複して選択できません。");
  }
  for (const rule of tokenRules) {
    const token = communityTokens.find(
      (entry) =>
        entry.id === rule.tokenId && entry.communityId === input.communityId,
    );
    if (!token) {
      throw new Error("投票に使用するコミュニティトークンを確認してください。");
    }
    if (
      !Number.isFinite(Number(rule.tokensPerVote)) ||
      Number(rule.tokensPerVote) <= 0 ||
      !Number.isFinite(Number(rule.weight)) ||
      Number(rule.weight) <= 0 ||
      Number(rule.weight) > 1000
    ) {
      throw new Error("基準保有量と倍率は0より大きい有効な数値にしてください。");
    }
  }
  const voteWeightCap = Number(input.voteWeightCap ?? 100);
  if (
    input.votingStrategy === "token_capped" &&
    (!Number.isInteger(voteWeightCap) || voteWeightCap < 1)
  ) {
    throw new Error("1人あたりの最大票数は1以上の整数にしてください。");
  }
  community.governanceVotingStrategy = input.votingStrategy;
  community.governanceTokenId = tokenRules[0]?.tokenId ?? null;
  community.governanceTokensPerVote =
    input.votingStrategy === "one_member_one_vote"
      ? 1
      : Number(tokenRules[0]?.tokensPerVote ?? 1);
  community.governanceTokenRules = tokenRules.map((rule) => ({
    tokenId: rule.tokenId,
    tokenSymbol: communityTokens.find((token) => token.id === rule.tokenId)
      ?.symbol,
    tokensPerVote: Number(rule.tokensPerVote),
    weight: Number(rule.weight),
  }));
  community.governanceVoteCap =
    input.votingStrategy === "token_capped" ? voteWeightCap : null;
  persistState();
  return { ...community };
}

export function createCommunityGovernanceProposal(input: {
  communityId: string;
  kind: CommunityGovernanceProposal["kind"];
  title: string;
  body: string;
  linkedGuideProposalId?: string | null;
}): CommunityGovernanceProposal {
  const { actor } = getActiveCommunityActor(input.communityId);
  const community = communities.find((entry) => entry.id === input.communityId);
  if (!community || community.governanceMode !== "dao") {
    throw new Error("DAO運営が有効なコミュニティだけが提案を作成できます。");
  }

  const title = input.title.normalize("NFKC").trim();
  const body = input.body.normalize("NFKC").trim();
  if (!title || title.length > 120) {
    throw new Error("提案名は1〜120文字で入力してください。");
  }
  if (!body || body.length > 5000) {
    throw new Error("提案本文は1〜5,000文字で入力してください。");
  }

  const linkedGuideProposalId = input.linkedGuideProposalId?.trim() || null;
  if (
    linkedGuideProposalId &&
    !communityGuideProposals.some(
      (proposal) =>
        proposal.id === linkedGuideProposalId &&
        proposal.communityId === input.communityId,
    )
  ) {
    throw new Error("関連する攻略提案が見つかりません。");
  }

  const activeMemberCount = communityMemberships.filter(
    (membership) =>
      membership.communityId === input.communityId &&
      (membership.status ?? "active") === "active",
  ).length;
  const votingStrategy =
    community.governanceVotingStrategy ?? "one_member_one_vote";
  const governanceTokenRules =
    votingStrategy === "one_member_one_vote"
      ? []
      : (community.governanceTokenRules?.length
          ? community.governanceTokenRules
          : community.governanceTokenId
            ? [
                {
                  tokenId: community.governanceTokenId,
                  tokenSymbol: communityTokens.find(
                    (token) => token.id === community.governanceTokenId,
                  )?.symbol,
                  tokensPerVote: Math.max(
                    0.000001,
                    community.governanceTokensPerVote ?? 1,
                  ),
                  weight: 1,
                },
              ]
            : []);
  if (votingStrategy !== "one_member_one_vote" && !governanceTokenRules.length) {
    throw new Error("投票に使用するコミュニティトークンを設定してください。");
  }
  const createdAt = new Date();
  const proposal: CommunityGovernanceProposal = {
    id: makeId("governance"),
    communityId: input.communityId,
    authorProfileId: actor.id,
    kind: input.kind,
    title,
    body,
    status: "voting",
    votingStrategy,
    governanceTokenId: governanceTokenRules[0]?.tokenId ?? null,
    governanceTokenSymbol: governanceTokenRules[0]?.tokenSymbol ?? null,
    tokensPerVote: governanceTokenRules[0]?.tokensPerVote ?? 1,
    governanceTokenRules: governanceTokenRules.map((rule) => ({ ...rule })),
    voteWeightCap:
      votingStrategy === "token_capped"
        ? Math.max(1, community.governanceVoteCap ?? 100)
        : null,
    quorum: Math.max(1, Math.ceil(activeMemberCount * 0.25)),
    approvalThreshold: 0.6,
    linkedGuideProposalId,
    votingStartsAt: createdAt.toISOString(),
    votingEndsAt: createdAt.toISOString(),
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
  communityGovernanceProposals.unshift(proposal);
  persistState();
  return { ...proposal };
}

export function castCommunityGovernanceVote(input: {
  communityId: string;
  proposalId: string;
  choice: CommunityGovernanceVote["choice"];
}) {
  const { actor } = getActiveCommunityActor(input.communityId);
  const proposal = communityGovernanceProposals.find(
    (entry) =>
      entry.id === input.proposalId && entry.communityId === input.communityId,
  );
  if (!proposal) throw new Error("DAO提案が見つかりません。");
  if (proposal.status !== "voting") {
    throw new Error("投票受付中の提案ではありません。");
  }

  const now = new Date();
  if (
    now.getTime() < new Date(proposal.votingStartsAt).getTime() ||
    now.getTime() >= new Date(proposal.votingEndsAt).getTime()
  ) {
    throw new Error("投票期間外です。");
  }

  const existing = communityGovernanceVotes.find(
    (vote) => vote.proposalId === proposal.id && vote.profileId === actor.id,
  );
  let weight = 1;
  if (proposal.votingStrategy !== "one_member_one_vote") {
    const rules =
      proposal.governanceTokenRules?.length
        ? proposal.governanceTokenRules
        : proposal.governanceTokenId
          ? [
              {
                tokenId: proposal.governanceTokenId,
                tokenSymbol: proposal.governanceTokenSymbol ?? undefined,
                tokensPerVote: proposal.tokensPerVote,
                weight: 1,
              },
            ]
          : [];
    if (!rules.length) throw new Error("投票対象トークンが見つかりません。");
    weight = calculateMultiTokenGovernanceVoteWeight({
      strategy: proposal.votingStrategy,
      holdings: rules.map((rule) => {
        const token = communityTokens.find(
          (entry) =>
            entry.id === rule.tokenId &&
            entry.communityId === input.communityId,
        );
        const balance = token
          ? (tokenBalances[actor.id]?.find(
              (entry) =>
                entry.symbol.toUpperCase() === token.symbol.toUpperCase() &&
                (!entry.network || entry.network === token.network),
            )?.amount ?? 0)
          : 0;
        return {
          balance,
          tokensPerVote: rule.tokensPerVote,
          weight: rule.weight,
        };
      }),
      voteWeightCap: proposal.voteWeightCap,
    });
    if (weight < 1) {
      throw new Error("設定された投票トークンの合算点が1点以上必要です。");
    }
  }
  const timestamp = now.toISOString();
  if (existing) {
    existing.choice = input.choice;
    existing.weight = weight;
    existing.updatedAt = timestamp;
  } else {
    communityGovernanceVotes.push({
      proposalId: proposal.id,
      profileId: actor.id,
      choice: input.choice,
      weight,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  proposal.updatedAt = timestamp;
  persistState();

  const votes = getCommunityGovernanceVotes(proposal.id);
  return {
    proposal: { ...proposal },
    vote: votes.find((vote) => vote.profileId === actor.id),
    votes,
  };
}

export function updateCommunityGovernanceProposalLifecycle(input: {
  communityId: string;
  proposalId: string;
  action: "start_voting" | "close_voting" | "execute" | "cancel";
}) {
  const { membership } = getActiveCommunityActor(input.communityId);
  if (
    membership.role !== "owner" &&
    membership.role !== "moderator"
  ) {
    throw new Error("DAO提案を進行できるのは運営メンバーだけです。");
  }
  const proposal = communityGovernanceProposals.find(
    (entry) =>
      entry.id === input.proposalId && entry.communityId === input.communityId,
  );
  if (!proposal) throw new Error("DAO提案が見つかりません。");
  const now = new Date();
  const updatedAt = now.toISOString();

  if (input.action === "start_voting") {
    if (proposal.status !== "discussion") {
      throw new Error("議論中の提案だけ投票を開始できます。");
    }
    proposal.status = "voting";
    proposal.votingStartsAt = updatedAt;
    proposal.votingEndsAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
  } else if (input.action === "close_voting") {
    if (proposal.status !== "voting") {
      throw new Error("投票中の提案だけ締め切れます。");
    }
    const votes = getCommunityGovernanceVotes(proposal.id);
    proposal.status = resolveGovernanceVoteResult({
      votes,
      quorum: proposal.quorum,
      approvalThreshold: proposal.approvalThreshold,
    });
    proposal.votingEndsAt = updatedAt;
  } else if (input.action === "execute") {
    if (membership.role !== "owner") {
      throw new Error("可決提案を実行済みにできるのはオーナーだけです。");
    }
    if (proposal.status !== "passed") {
      throw new Error("可決された提案だけ実行済みにできます。");
    }
    proposal.status = "executed";
    proposal.executedAt = updatedAt;
  } else {
    if (proposal.status !== "discussion" && proposal.status !== "voting") {
      throw new Error("議論中または投票中の提案だけ中止できます。");
    }
    proposal.status = "cancelled";
    if (proposal.votingEndsAt > updatedAt) proposal.votingEndsAt = updatedAt;
  }
  proposal.updatedAt = updatedAt;
  persistState();
  return {
    proposal: { ...proposal },
    votes: getCommunityGovernanceVotes(proposal.id),
  };
}

export function createCommunityGuideProposal(input: {
  communityId: string;
  pageId?: string | null;
  proposedDirectoryId?: string | null;
  title: string;
  proposedTitle: string;
  proposedBody: string;
  summary: string;
}) {
  const { actor } = getActiveCommunityActor(input.communityId);
  const page = input.pageId
    ? communityGuidePages.find(
        (entry) =>
          entry.id === input.pageId && entry.communityId === input.communityId,
      )
    : undefined;
  if (input.pageId && !page)
    throw new Error("Guide page does not exist in this community.");
  const proposedDirectoryId =
    input.proposedDirectoryId ?? page?.directoryId ?? null;
  if (
    proposedDirectoryId &&
    !communityGuideDirectories.some(
      (directory) =>
        directory.id === proposedDirectoryId &&
        directory.communityId === input.communityId,
    )
  ) {
    throw new Error("Guide directory does not exist in this community.");
  }
  const { title, proposedTitle, proposedBody, summary } =
    normalizeGuideProposalInput(input);
  const now = new Date().toISOString();
  const proposal: CommunityGuideProposal = {
    id: makeId("guide-proposal"),
    communityId: input.communityId,
    pageId: page?.id ?? null,
    proposedDirectoryId,
    authorProfileId: actor.id,
    title,
    proposedTitle,
    proposedBody,
    summary,
    status: "open",
    baseVersion: page?.version ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  communityGuideProposals.push(proposal);
  persistState();
  return { ...proposal };
}

export function reviewCommunityGuideProposal(input: {
  communityId: string;
  proposalId: string;
  body: string;
  decision: "comment" | "approve" | "request_changes";
}) {
  const { actor } = getActiveCommunityActor(input.communityId);
  const proposal = communityGuideProposals.find(
    (entry) =>
      entry.id === input.proposalId && entry.communityId === input.communityId,
  );
  if (!proposal) throw new Error("Guide proposal does not exist.");
  if (proposal.status === "merged" || proposal.status === "closed")
    throw new Error("This proposal is no longer reviewable.");
  if (actor.id === proposal.authorProfileId && input.decision !== "comment")
    throw new Error("Authors cannot approve their own proposal.");
  const body = normalizeGuideReviewBody(input.body);
  const createdAt = new Date().toISOString();
  const review: CommunityGuideReview = {
    id: makeId("guide-review"),
    proposalId: proposal.id,
    authorProfileId: actor.id,
    body,
    decision: input.decision,
    createdAt,
  };
  communityGuideReviews.push(review);
  if (input.decision === "request_changes")
    proposal.status = "changes_requested";
  if (input.decision === "approve" && proposal.status === "changes_requested")
    proposal.status = "open";
  proposal.updatedAt = createdAt;
  persistState();
  return { review: { ...review }, proposal: { ...proposal } };
}

export function updateCommunityGuideProposalStatus(input: {
  communityId: string;
  proposalId: string;
  action: "merge" | "close" | "reopen";
}) {
  const { actor, membership } = getActiveCommunityActor(input.communityId);
  const proposal = communityGuideProposals.find(
    (entry) =>
      entry.id === input.proposalId && entry.communityId === input.communityId,
  );
  if (!proposal) throw new Error("Guide proposal does not exist.");
  const canManage =
    membership.role === "owner" || membership.role === "moderator";
  const now = new Date().toISOString();
  if (input.action === "merge") {
    const page = proposal.pageId
      ? communityGuidePages.find((entry) => entry.id === proposal.pageId)
      : undefined;
    const proposalReviews = communityGuideReviews.filter(
      (review) => review.proposalId === proposal.id,
    );
    assertGuideMergeAllowed({
      isManager: canManage,
      status: proposal.status,
      hasIndependentApproval: hasIndependentGuideApproval(
        proposalReviews,
        proposal.authorProfileId,
      ),
      baseVersion: proposal.baseVersion,
      currentVersion: page?.version ?? 0,
    });
    if (page) {
      page.title = proposal.proposedTitle;
      page.body = proposal.proposedBody;
      page.directoryId = proposal.proposedDirectoryId ?? null;
      page.version += 1;
      page.updatedByProfileId = actor.id;
      page.updatedAt = now;
    } else {
      const created: CommunityGuidePage = {
        id: makeId("guide"),
        communityId: input.communityId,
        directoryId: proposal.proposedDirectoryId ?? null,
        slug: makeCommunityGuideSlug(
          proposal.proposedTitle,
          communityGuidePages
            .filter((entry) => entry.communityId === input.communityId)
            .map((entry) => entry.slug),
        ),
        title: proposal.proposedTitle,
        body: proposal.proposedBody,
        version: 1,
        updatedByProfileId: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      communityGuidePages.push(created);
      proposal.pageId = created.id;
    }
    proposal.status = "merged";
    proposal.mergedAt = now;
    proposal.mergedByProfileId = actor.id;
  } else if (input.action === "close") {
    if (!canManage && proposal.authorProfileId !== actor.id)
      throw new Error(
        "Only the author or a community manager can close this proposal.",
      );
    if (proposal.status === "merged")
      throw new Error("Merged proposals cannot be closed.");
    proposal.status = "closed";
  } else {
    if (!canManage && proposal.authorProfileId !== actor.id)
      throw new Error(
        "Only the author or a community manager can reopen this proposal.",
      );
    if (proposal.status !== "closed")
      throw new Error("Only closed proposals can be reopened.");
    proposal.status = "open";
  }
  proposal.updatedAt = now;
  persistState();
  return {
    proposal: { ...proposal },
    pages: getCommunityGuidePages(input.communityId),
  };
}

export function getCommunityMemberships(
  communityId?: string,
): CommunityMembership[] {
  return communityMemberships
    .filter(
      (membership) => !communityId || membership.communityId === communityId,
    )
    .map((membership) => ({ ...membership }));
}

export function getCommunityTokens(
  communityId?: string,
): CommunityTokenDefinition[] {
  return communityTokens
    .filter((token) => !communityId || token.communityId === communityId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((token) => ({ ...token }));
}

export function createCommunityToken(input: {
  communityId: string;
  name: string;
  symbol: string;
  network: string;
  contractAddress?: string;
}) {
  const actor = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId &&
      entry.profileId === currentProfile().id,
  );
  if (actor?.role !== "owner" || (actor.status ?? "active") === "banned") {
    throw new Error("Only the community owner can add tokens.");
  }
  const name = input.name.trim();
  const symbol = input.symbol.trim().toUpperCase();
  const network = input.network.trim();
  const contractAddress = input.contractAddress?.trim() || undefined;
  if (!name || name.length > 80)
    throw new Error("Token name must be between 1 and 80 characters.");
  if (!/^[A-Z0-9._-]{1,16}$/.test(symbol))
    throw new Error("Token symbol is invalid.");
  if (!network || network.length > 40)
    throw new Error("Network must be between 1 and 40 characters.");
  if (contractAddress && contractAddress.length > 128)
    throw new Error("Contract address is too long.");
  if (
    communityTokens.some(
      (token) =>
        token.communityId === input.communityId &&
        token.symbol === symbol &&
        token.network.toLocaleLowerCase("en") ===
          network.toLocaleLowerCase("en"),
    )
  ) {
    throw new Error("This token is already registered in the community.");
  }
  const created: CommunityTokenDefinition = {
    id: makeId("community-token"),
    communityId: input.communityId,
    name,
    symbol,
    network,
    contractAddress,
    createdByProfileId: actor.profileId,
    createdAt: new Date().toISOString(),
  };
  communityTokens.push(created);
  persistState();
  return { ...created };
}

export function getCommunityChannels(communityId?: string): CommunityChannel[] {
  return communityChannels
    .filter((channel) => !communityId || channel.communityId === communityId)
    .sort(
      (left, right) =>
        left.position - right.position ||
        left.createdAt.localeCompare(right.createdAt),
    )
    .map((channel) => ({ ...channel }));
}

export function getCommunityChannelMessages(
  channelId: string,
): CommunityChannelMessage[] {
  return communityChannelMessages
    .filter((message) => message.channelId === channelId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((message) => ({ ...message }));
}

export function getCommunityChannelMessageById(
  messageId: string,
): CommunityChannelMessage | undefined {
  const message = communityChannelMessages.find((candidate) => candidate.id === messageId);
  return message ? { ...message } : undefined;
}

export function getCommunityChannelReactions(
  messageId?: string,
): CommunityChannelReaction[] {
  return communityChannelReactions
    .filter((reaction) => !messageId || reaction.messageId === messageId)
    .map((reaction) => ({ ...reaction }));
}

export function getCommunityChannelReadStates(
  profileId = currentProfile().id,
): CommunityChannelReadState[] {
  return communityChannelReadStates
    .filter((state) => state.profileId === profileId)
    .map((state) => ({ ...state }));
}

export function createCommunityChannel(input: {
  communityId: string;
  name: string;
  description: string;
}): CommunityChannel {
  const me = currentProfile();
  const community = communities.find((entry) => entry.id === input.communityId);
  if (!community) throw new Error("Community does not exist.");
  const membership = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId && entry.profileId === me.id,
  );
  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "moderator")
  ) {
    throw new Error(
      "Only community owners and moderators can create channels.",
    );
  }
  const normalizedName = input.name.trim();
  const normalizedDescription = input.description.trim();
  if (normalizedName.length < 1 || normalizedName.length > 50)
    throw new Error("Channel name must be between 1 and 50 characters.");
  if (normalizedDescription.length > 200)
    throw new Error("Channel description must be 200 characters or fewer.");
  if (
    communityChannels.some(
      (channel) =>
        channel.communityId === input.communityId &&
        channel.name.toLocaleLowerCase("ja") ===
          normalizedName.toLocaleLowerCase("ja"),
    )
  ) {
    throw new Error("A channel with that name already exists.");
  }
  const created: CommunityChannel = {
    id: makeId("channel"),
    communityId: input.communityId,
    name: normalizedName,
    description: normalizedDescription,
    position: communityChannels.filter(
      (channel) => channel.communityId === input.communityId,
    ).length,
    createdAt: new Date().toISOString(),
  };
  communityChannels.push(created);
  persistState();
  return { ...created };
}

function requireCommunityManager(communityId: string) {
  const membership = communityMemberships.find(
    (entry) =>
      entry.communityId === communityId &&
      entry.profileId === currentProfile().id &&
      (entry.status ?? "active") !== "banned",
  );
  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "moderator")
  )
    throw new Error(
      "Only community owners and moderators can manage channels.",
    );
  return membership;
}

export function updateCommunityChannel(input: {
  communityId: string;
  channelId: string;
  name?: string;
  description?: string;
  direction?: "up" | "down";
}) {
  requireCommunityManager(input.communityId);
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  if (!channel) throw new Error("Channel does not exist in this community.");
  if (input.direction) {
    const ordered = communityChannels
      .filter((entry) => entry.communityId === input.communityId)
      .sort((left, right) => left.position - right.position);
    const index = ordered.findIndex((entry) => entry.id === channel.id);
    const swapIndex = input.direction === "up" ? index - 1 : index + 1;
    if (swapIndex >= 0 && swapIndex < ordered.length) {
      const other = ordered[swapIndex];
      [channel.position, other.position] = [other.position, channel.position];
    }
  } else {
    const name = input.name?.trim() ?? channel.name;
    const description = input.description?.trim() ?? channel.description;
    if (!name || name.length > 50)
      throw new Error("Channel name must be between 1 and 50 characters.");
    if (description.length > 200)
      throw new Error("Channel description must be 200 characters or fewer.");
    if (
      communityChannels.some(
        (entry) =>
          entry.id !== channel.id &&
          entry.communityId === input.communityId &&
          entry.name.toLocaleLowerCase("ja") === name.toLocaleLowerCase("ja"),
      )
    )
      throw new Error("A channel with that name already exists.");
    channel.name = name;
    channel.description = description;
  }
  persistState();
  return { ...channel };
}

export function deleteCommunityChannel(input: {
  communityId: string;
  channelId: string;
}) {
  requireCommunityManager(input.communityId);
  const communityEntries = communityChannels.filter(
    (entry) => entry.communityId === input.communityId,
  );
  if (communityEntries.length <= 1)
    throw new Error("A community must keep at least one channel.");
  const index = communityChannels.findIndex(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  if (index < 0) throw new Error("Channel does not exist in this community.");
  const messageIds = new Set(
    communityChannelMessages
      .filter((message) => message.channelId === input.channelId)
      .map((message) => message.id),
  );
  communityChannels.splice(index, 1);
  replaceArrayContents(
    communityChannelMessages,
    communityChannelMessages.filter(
      (message) => message.channelId !== input.channelId,
    ),
  );
  replaceArrayContents(
    communityChannelReactions,
    communityChannelReactions.filter(
      (reaction) => !messageIds.has(reaction.messageId),
    ),
  );
  replaceArrayContents(
    communityChannelReadStates,
    communityChannelReadStates.filter(
      (state) => state.channelId !== input.channelId,
    ),
  );
  replaceArrayContents(
    communityMessageReports,
    communityMessageReports.filter(
      (report) => report.channelId !== input.channelId,
    ),
  );
  getCommunityChannels(input.communityId).forEach((entry, position) => {
    const stored = communityChannels.find(
      (candidate) => candidate.id === entry.id,
    );
    if (stored) stored.position = position;
  });
  persistState();
  return { deleted: true, channelId: input.channelId };
}

export function createCommunityChannelMessage(input: {
  communityId: string;
  channelId: string;
  body: string;
  replyToMessageId?: string | null;
  kind?: "chat" | "guide" | "question" | "party";
}): CommunityChannelMessage {
  const me = currentProfile();
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  if (!channel) throw new Error("Channel does not exist in this community.");
  const membership = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId && entry.profileId === me.id,
  );
  if (!membership || (membership.status ?? "active") !== "active") {
    throw new Error("Join the community before posting to a channel.");
  }
  const body = input.body.trim();
  if (!body || body.length > 2000)
    throw new Error("Message must be between 1 and 2000 characters.");
  const replyTarget = input.replyToMessageId
    ? communityChannelMessages.find(
        (message) =>
          message.id === input.replyToMessageId &&
          message.channelId === channel.id,
      )
    : undefined;
  if (input.replyToMessageId && !replyTarget)
    throw new Error("Reply target does not exist in this channel.");
  const created: CommunityChannelMessage = {
    id: makeId("channel-message"),
    channelId: channel.id,
    authorProfileId: me.id,
    body,
    createdAt: new Date().toISOString(),
    replyToMessageId: replyTarget?.id ?? null,
    kind: input.kind ?? "chat",
  };
  communityChannelMessages.push(created);
  persistState();
  return { ...created };
}

export function setCommunityChannelMessagePinned(input: {
  communityId: string;
  channelId: string;
  messageId: string;
  pinned: boolean;
}) {
  requireCommunityManager(input.communityId);
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  const message = communityChannelMessages.find(
    (entry) =>
      entry.id === input.messageId && entry.channelId === input.channelId,
  );
  if (!channel || !message)
    throw new Error("Message does not exist in this channel.");
  message.pinnedAt = input.pinned ? new Date().toISOString() : null;
  message.pinnedByProfileId = input.pinned ? currentProfile().id : null;
  persistState();
  return { ...message };
}

export function setCommunityChannelMessageWorkflow(input: {
  communityId: string;
  channelId: string;
  messageId: string;
  workflowStatus: "open" | "resolved" | "closed";
}) {
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  const message = communityChannelMessages.find(
    (entry) =>
      entry.id === input.messageId && entry.channelId === input.channelId,
  );
  if (!channel || !message)
    throw new Error("Message does not exist in this channel.");
  const membership = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId &&
      entry.profileId === currentProfile().id,
  );
  const canManage =
    membership?.role === "owner" || membership?.role === "moderator";
  if (message.authorProfileId !== currentProfile().id && !canManage) {
    throw new Error(
      "Only the author or a community manager can change this status.",
    );
  }
  if ((membership?.status ?? "active") !== "active")
    throw new Error("This member cannot change post status.");
  const kind = message.kind ?? "chat";
  if (kind === "question" && input.workflowStatus === "closed")
    throw new Error("Questions cannot use the closed status.");
  if (kind === "party" && input.workflowStatus === "resolved")
    throw new Error("Party recruitment cannot use the resolved status.");
  if (kind !== "question" && kind !== "party")
    throw new Error("This post type does not have a workflow status.");
  message.workflowStatus = input.workflowStatus;
  message.editedAt = new Date().toISOString();
  persistState();
  return { ...message };
}

export function updateCommunityChannelMessage(input: {
  communityId: string;
  channelId: string;
  messageId: string;
  body: string;
}) {
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  const message = communityChannelMessages.find(
    (entry) =>
      entry.id === input.messageId && entry.channelId === input.channelId,
  );
  if (!channel || !message)
    throw new Error("Message does not exist in this channel.");
  if (message.authorProfileId !== currentProfile().id)
    throw new Error("Only the author can edit this message.");
  const body = input.body.trim();
  if (!body || body.length > 2000)
    throw new Error("Message must be between 1 and 2000 characters.");
  message.body = body;
  message.editedAt = new Date().toISOString();
  persistState();
  return { ...message };
}

export function deleteCommunityChannelMessage(input: {
  communityId: string;
  channelId: string;
  messageId: string;
}) {
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  const index = communityChannelMessages.findIndex(
    (entry) =>
      entry.id === input.messageId && entry.channelId === input.channelId,
  );
  if (!channel || index < 0)
    throw new Error("Message does not exist in this channel.");
  const message = communityChannelMessages[index];
  const membership = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId &&
      entry.profileId === currentProfile().id,
  );
  const canModerate =
    membership?.role === "owner" || membership?.role === "moderator";
  if (message.authorProfileId !== currentProfile().id && !canModerate)
    throw new Error("You cannot delete this message.");
  communityChannelMessages.splice(index, 1);
  communityChannelMessages.forEach((entry) => {
    if (entry.replyToMessageId === input.messageId)
      entry.replyToMessageId = null;
  });
  replaceArrayContents(
    communityChannelReactions,
    communityChannelReactions.filter(
      (reaction) => reaction.messageId !== input.messageId,
    ),
  );
  persistState();
  return { deleted: true, messageId: input.messageId };
}

export function reportCommunityChannelMessage(input: {
  communityId: string;
  channelId: string;
  messageId: string;
  reason: CommunityMessageReport["reason"];
}) {
  const me = currentProfile();
  const message = communityChannelMessages.find(
    (entry) =>
      entry.id === input.messageId && entry.channelId === input.channelId,
  );
  if (
    !message ||
    !communityChannels.some(
      (entry) =>
        entry.id === input.channelId && entry.communityId === input.communityId,
    )
  )
    throw new Error("Message does not exist in this channel.");
  if (message.authorProfileId === me.id)
    throw new Error("You cannot report your own message.");
  const existing = communityMessageReports.find(
    (entry) =>
      entry.messageId === input.messageId &&
      entry.reporterProfileId === me.id &&
      entry.status === "open",
  );
  if (existing) return { report: { ...existing }, submitted: false };
  const report: CommunityMessageReport = {
    id: makeId("community-report"),
    communityId: input.communityId,
    channelId: input.channelId,
    messageId: input.messageId,
    reporterProfileId: me.id,
    reason: input.reason,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  communityMessageReports.push(report);
  persistState();
  return { report: { ...report }, submitted: true };
}

export function manageCommunityMember(input: {
  communityId: string;
  profileId: string;
  action: "promote" | "demote" | "mute" | "unmute" | "ban";
}) {
  const actor = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId &&
      entry.profileId === currentProfile().id,
  );
  if (actor?.role !== "owner")
    throw new Error("Only the community owner can manage members.");
  const target = communityMemberships.find(
    (entry) =>
      entry.communityId === input.communityId &&
      entry.profileId === input.profileId,
  );
  if (!target) throw new Error("Community member does not exist.");
  if (target.role === "owner" || target.profileId === actor.profileId)
    throw new Error("The community owner cannot be changed.");
  if (input.action === "promote") target.role = "moderator";
  if (input.action === "demote") target.role = "member";
  if (input.action === "mute") target.status = "muted";
  if (input.action === "unmute") target.status = "active";
  if (input.action === "ban") target.status = "banned";
  persistState();
  return {
    profileId: target.profileId,
    role: target.role,
    status: target.status ?? "active",
  };
}

export function toggleCommunityChannelReaction(input: {
  communityId: string;
  channelId: string;
  messageId: string;
  emoji: CommunityChannelReaction["emoji"];
}) {
  const me = currentProfile();
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  if (!channel) throw new Error("Channel does not exist in this community.");
  if (
    !communityMemberships.some(
      (entry) =>
        entry.communityId === input.communityId &&
        entry.profileId === me.id &&
        (entry.status ?? "active") === "active",
    )
  ) {
    throw new Error("Join the community before reacting.");
  }
  if (
    !communityChannelMessages.some(
      (message) =>
        message.id === input.messageId && message.channelId === channel.id,
    )
  ) {
    throw new Error("Message does not exist in this channel.");
  }
  const existingIndex = communityChannelReactions.findIndex(
    (reaction) =>
      reaction.messageId === input.messageId &&
      reaction.profileId === me.id &&
      reaction.emoji === input.emoji,
  );
  let active = true;
  if (existingIndex >= 0) {
    communityChannelReactions.splice(existingIndex, 1);
    active = false;
  } else {
    communityChannelReactions.push({
      messageId: input.messageId,
      profileId: me.id,
      emoji: input.emoji,
      createdAt: new Date().toISOString(),
    });
  }
  persistState();
  return { active, reactions: getCommunityChannelReactions(input.messageId) };
}

export function markCommunityChannelRead(input: {
  communityId: string;
  channelId: string;
  lastReadMessageId: string | null;
}) {
  const me = currentProfile();
  const channel = communityChannels.find(
    (entry) =>
      entry.id === input.channelId && entry.communityId === input.communityId,
  );
  if (!channel) throw new Error("Channel does not exist in this community.");
  if (
    !communityMemberships.some(
      (entry) =>
        entry.communityId === input.communityId && entry.profileId === me.id,
    )
  ) {
    throw new Error("Join the community before marking it read.");
  }
  if (
    input.lastReadMessageId &&
    !communityChannelMessages.some(
      (message) =>
        message.id === input.lastReadMessageId &&
        message.channelId === channel.id,
    )
  ) {
    throw new Error("Read marker does not belong to this channel.");
  }
  const existing = communityChannelReadStates.find(
    (state) => state.channelId === channel.id && state.profileId === me.id,
  );
  const updatedAt = new Date().toISOString();
  if (existing) {
    existing.lastReadMessageId = input.lastReadMessageId;
    existing.updatedAt = updatedAt;
  } else {
    communityChannelReadStates.push({
      channelId: channel.id,
      profileId: me.id,
      lastReadMessageId: input.lastReadMessageId,
      updatedAt,
    });
  }
  persistState();
  return {
    channelId: channel.id,
    lastReadMessageId: input.lastReadMessageId,
    unreadCount: 0,
  };
}

export function createCommunity(input: {
  name: string;
  description: string;
  category: string;
  imageUrl?: string;
}): Community {
  const owner = currentProfile();
  const createdAt = new Date().toISOString();
  const id = makeId("community");
  const created: Community = {
    id,
    slug: id,
    name: input.name.trim(),
    imageUrl: input.imageUrl,
    description: input.description.trim(),
    category: input.category.trim(),
    ownerProfileId: owner.id,
    createdAt,
  };
  communities.unshift(created);
  communityMemberships.push({
    communityId: id,
    profileId: owner.id,
    role: "owner",
    joinedAt: createdAt,
  });
  communityChannels.push({
    id: makeId("channel"),
    communityId: id,
    name: "一般",
    description: "コミュニティの最初のチャンネル",
    position: 0,
    createdAt,
  });
  persistState();
  return { ...created };
}

export function updateCommunity(input: {
  communityId: string;
  name?: string;
  description?: string;
  category?: string;
  knowledgeLabel?: string;
  knowledgeDescription?: string;
  imageUrl?: string;
}): Community {
  const community = communities.find((entry) => entry.id === input.communityId);
  if (!community) throw new Error("Community does not exist.");
  if (community.ownerProfileId !== currentProfile().id)
    throw new Error("Only the owner can edit the community.");
  if (input.name !== undefined) community.name = input.name.trim();
  if (input.description !== undefined)
    community.description = input.description.trim();
  if (input.category !== undefined) community.category = input.category.trim();
  if (input.knowledgeLabel !== undefined)
    community.knowledgeLabel = input.knowledgeLabel.trim();
  if (input.knowledgeDescription !== undefined)
    community.knowledgeDescription = input.knowledgeDescription.trim();
  if (input.imageUrl !== undefined) community.imageUrl = input.imageUrl;
  persistState();
  return { ...community };
}

export function toggleCommunityMembership(
  communityId: string,
  profileId = currentProfile().id,
) {
  const community = communities.find((entry) => entry.id === communityId);
  if (!community) throw new Error("Community does not exist.");
  const index = communityMemberships.findIndex(
    (membership) =>
      membership.communityId === communityId &&
      membership.profileId === profileId,
  );
  if (index >= 0) {
    if (communityMemberships[index].status === "banned")
      throw new Error("This profile is banned from the community.");
    if (communityMemberships[index].role === "owner")
      throw new Error("Owner cannot leave the community.");
    communityMemberships.splice(index, 1);
    persistState();
    return { joined: false, role: null };
  }
  communityMemberships.push({
    communityId,
    profileId,
    role: "member",
    joinedAt: new Date().toISOString(),
  });
  persistState();
  return { joined: true, role: "member" as const };
}

export function getBoards(): Board[] {
  return [...boards];
}

export function getBoardByKey(boardKey: string): Board | undefined {
  const normalizedBoardKey = normalizeBoardKey(boardKey);
  return boards.find((board) => board.key === normalizedBoardKey);
}

export function getThreads(boardKey?: string): ThreadSummary[] {
  const normalizedBoardKey = boardKey ? normalizeBoardKey(boardKey) : undefined;
  const entries = boardKey
    ? threads.filter((thread) => thread.boardKey === normalizedBoardKey)
    : threads;

  return [...entries].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function getThreadById(threadId: string): ThreadSummary | undefined {
  return threads.find((thread) => thread.id === threadId);
}

export function getThreadTracking(
  threadId: string,
  profileId = currentProfile().id,
): ThreadTracking | undefined {
  const entry = threadTracking.find(
    (item) => item.threadId === threadId && item.profileId === profileId,
  );
  return entry ? { ...entry } : undefined;
}

function ensureThreadTracking(
  threadId: string,
  profileId: string,
): ThreadTracking {
  const existing = threadTracking.find(
    (item) => item.threadId === threadId && item.profileId === profileId,
  );
  if (existing) return existing;

  const created: ThreadTracking = {
    threadId,
    profileId,
    following: false,
    lastReadPostNo: 0,
    updatedAt: new Date().toISOString(),
  };
  threadTracking.push(created);
  return created;
}

export function toggleThreadFollowing(
  threadId: string,
  profileId = currentProfile().id,
): ThreadTracking {
  if (!getThreadById(threadId)) throw new Error("Thread does not exist.");
  const tracking = ensureThreadTracking(threadId, profileId);
  tracking.following = !tracking.following;
  tracking.updatedAt = new Date().toISOString();
  persistState();
  return { ...tracking };
}

export function markThreadRead(
  threadId: string,
  lastReadPostNo: number,
  profileId = currentProfile().id,
): ThreadTracking {
  const thread = getThreadById(threadId);
  if (!thread) throw new Error("Thread does not exist.");
  const tracking = ensureThreadTracking(threadId, profileId);
  const normalizedPostNo = normalizeLastReadPostNo(
    lastReadPostNo,
    thread.postCount,
  );
  tracking.lastReadPostNo = Math.max(tracking.lastReadPostNo, normalizedPostNo);
  tracking.updatedAt = new Date().toISOString();
  persistState();
  return { ...tracking };
}

export function setThreadBestAnswer(
  threadId: string,
  postId: string | null,
  profileId = currentProfile().id,
): ThreadSummary {
  const thread = getThreadById(threadId);
  if (!thread) throw new Error("Thread does not exist.");
  if (
    (thread.threadType ?? (thread.bestAnswerPostId ? "question" : "chat")) !==
    "question"
  ) {
    throw new Error("ベスト回答を選べるのは質問スレッドだけです。");
  }
  const firstPost = getPostsForThread(threadId).find((post) => post.no === 1);
  if (!firstPost?.authorProfileId || firstPost.authorProfileId !== profileId) {
    throw new Error("Only the thread creator can choose the best answer.");
  }

  if (postId) {
    const selectedPost = getThreadPostById(postId);
    if (
      !selectedPost ||
      selectedPost.threadId !== threadId ||
      selectedPost.no === 1
    ) {
      throw new Error("The selected reply does not belong to this thread.");
    }
    thread.bestAnswerPostId = postId;
    thread.solvedAt = new Date().toISOString();
  } else {
    delete thread.bestAnswerPostId;
    delete thread.solvedAt;
  }

  persistState();
  return { ...thread };
}

export function getPostsForThread(threadId: string): ThreadPost[] {
  return threadPosts
    .filter((post) => post.threadId === threadId)
    .sort((left, right) => left.no - right.no);
}

export function getSocialPosts(): SocialPost[] {
  return [...socialPosts].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function getSocialPostById(postId: string): SocialPost | undefined {
  return socialPosts.find((post) => post.id === postId);
}

export function getTopLevelSocialPosts(): SocialPost[] {
  return getSocialPosts().filter((post) => !post.replyToPostId);
}

export function getRepliesForSocialPost(postId: string): SocialPost[] {
  return getSocialPosts().filter((post) => post.replyToPostId === postId);
}

export function getTokenBalances(profileId: string): TokenBalanceEntry[] {
  return [...(tokenBalances[profileId] ?? [])];
}

export function setTokenBalance(
  profileId: string,
  input: TokenBalanceEntry,
): TokenBalanceEntry {
  const balances = tokenBalances[profileId] ?? [];
  const index = balances.findIndex(
    (entry) =>
      entry.symbol.toLocaleUpperCase("en") ===
        input.symbol.toLocaleUpperCase("en") &&
      (!entry.network ||
        !input.network ||
        entry.network.toLocaleLowerCase("en") ===
          input.network.toLocaleLowerCase("en")),
  );
  if (index >= 0) balances[index] = { ...input };
  else balances.push({ ...input });
  tokenBalances[profileId] = balances;
  persistState();
  return { ...input };
}

export function getTokenRankings(): TokenRankingDefinition[] {
  return [...tokenRankings].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function getTokenRankingById(
  rankingId: string,
): TokenRankingDefinition | undefined {
  return tokenRankings.find((ranking) => ranking.id === rankingId);
}

export function createTokenRanking(input: {
  title: string;
  symbol: string;
  network: string;
  contractAddress?: string;
  description: string;
  createdByProfileId?: string;
}): TokenRankingDefinition {
  const created: TokenRankingDefinition = {
    id: makeId("token-ranking"),
    title: input.title,
    symbol: input.symbol,
    network: input.network,
    contractAddress: input.contractAddress,
    description: input.description,
    createdByProfileId: input.createdByProfileId ?? currentProfile().id,
    createdAt: new Date().toISOString(),
  };

  tokenRankings.unshift(created);
  persistState();
  return { ...created };
}

export function getLists(): UserList[] {
  return [...lists].sort((left, right) => left.order - right.order);
}

export function getBookmarks(): BookmarkItem[] {
  return [...bookmarks].filter(
    (bookmark) =>
      bookmark.targetType === "thread" ||
      bookmark.targetType === "thread_post" ||
      bookmark.targetType === "social_post",
  );
}

export function getReactions() {
  return [...reactions];
}

export function getThreadPostById(
  threadPostId: string,
): ThreadPost | undefined {
  return threadPosts.find((post) => post.id === threadPostId);
}

export function getThreadUserControlForPost(
  postId: string,
  ownerProfileId = currentProfile().id,
) {
  const post = getThreadPostById(postId);
  const targetProfileId = post?.authorProfileId ?? null;
  const control = targetProfileId
    ? threadUserControls.find(
        (item) =>
          item.ownerProfileId === ownerProfileId &&
          item.targetProfileId === targetProfileId,
      )
    : undefined;
  return {
    canControl: Boolean(targetProfileId && targetProfileId !== ownerProfileId),
    muted: control?.muted ?? false,
    blocked: control?.blocked ?? false,
  };
}

export function toggleThreadUserControl(
  postId: string,
  action: "mute" | "block",
  ownerProfileId = currentProfile().id,
) {
  const post = getThreadPostById(postId);
  if (!post) throw new Error("Post does not exist.");
  if (!post.authorProfileId)
    throw new Error("This legacy anonymous author cannot be controlled.");
  if (post.authorProfileId === ownerProfileId)
    throw new Error("You cannot control your own profile.");
  let control = threadUserControls.find(
    (item) =>
      item.ownerProfileId === ownerProfileId &&
      item.targetProfileId === post.authorProfileId,
  );
  if (!control) {
    control = {
      ownerProfileId,
      targetProfileId: post.authorProfileId,
      muted: false,
      blocked: false,
      updatedAt: new Date().toISOString(),
    };
    threadUserControls.push(control);
  }
  if (action === "mute") control.muted = !control.muted;
  else control.blocked = !control.blocked;
  control.updatedAt = new Date().toISOString();
  persistState();
  return { muted: control.muted, blocked: control.blocked };
}

export function reportThreadPost(input: {
  postId: string;
  reason: ThreadReportReason;
  details?: string;
  reporterProfileId?: string;
}) {
  const post = getThreadPostById(input.postId);
  if (!post) throw new Error("Post does not exist.");
  const reporterProfileId = input.reporterProfileId ?? currentProfile().id;
  if (canManageThreadPost(post, reporterProfileId))
    throw new Error("You cannot report your own post.");
  const existing = threadPostReports.find(
    (item) =>
      item.postId === input.postId &&
      item.reporterProfileId === reporterProfileId &&
      item.status === "open",
  );
  if (existing) return { reportId: existing.id, submitted: false };
  const report: ThreadPostReport = {
    id: makeId("thread-report"),
    postId: input.postId,
    reporterProfileId,
    reason: input.reason,
    details: input.details?.trim() ?? "",
    status: "open",
    createdAt: new Date().toISOString(),
  };
  threadPostReports.unshift(report);
  persistState();
  return { reportId: report.id, submitted: true };
}

export function listThreadPostReports(
  status: ThreadPostReport["status"] | "all" = "open",
): ThreadModerationReportView[] {
  return threadPostReports
    .filter((report) => status === "all" || report.status === status)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .flatMap((report) => {
      const post = getThreadPostById(report.postId);
      const thread = post ? getThreadById(post.threadId) : undefined;
      if (!post || !thread) return [];
      const publicPost = toPublicThreadPost(post);
      return [
        {
          ...report,
          postNo: post.no,
          threadId: post.threadId,
          threadTitle: thread.title,
          postBody: post.body,
          postDeletedAt: post.deletedAt,
          postModeratedAt: post.moderatedAt,
          authorDisplayName: publicPost.displayName,
          reporterDisplayName:
            getProfileById(report.reporterProfileId)?.displayName ??
            "削除済みユーザー",
        },
      ];
    });
}

export function resolveThreadPostReport(
  reportId: string,
  resolution: "resolved" | "dismissed",
  note: string,
) {
  const report = threadPostReports.find(
    (item) => item.id === reportId && item.status === "open",
  );
  if (!report) throw new Error("Open report does not exist.");
  report.status = resolution;
  report.resolutionNote = note.trim();
  report.resolvedAt = new Date().toISOString();
  persistState();
  return { ...report };
}

export function hideReportedThreadPost(reportId: string, note: string) {
  const report = threadPostReports.find(
    (item) => item.id === reportId && item.status === "open",
  );
  if (!report) throw new Error("Open report does not exist.");
  const post = getThreadPostById(report.postId);
  if (!post) throw new Error("Post does not exist.");
  const moderatedAt = new Date().toISOString();
  if (!post.moderatedAt) {
    threadPostRevisions.push({
      id: makeId("thread-revision"),
      postId: post.id,
      body: post.body,
      createdAt: moderatedAt,
    });
    post.moderatedAt = moderatedAt;
    post.moderationReason = note.trim() || "コミュニティガイドライン違反";
    const thread = getThreadById(post.threadId);
    if (thread?.bestAnswerPostId === post.id) {
      delete thread.bestAnswerPostId;
      delete thread.solvedAt;
    }
  }
  report.status = "resolved";
  report.resolutionNote = note.trim();
  report.resolvedAt = moderatedAt;
  persistState();
  return { ...report, postId: post.id };
}

export function editThreadPost(
  postId: string,
  body: string,
  profileId = currentProfile().id,
): ThreadPost {
  const post = getThreadPostById(postId);
  if (!post) throw new Error("Post does not exist.");
  if (!canManageThreadPost(post, profileId))
    throw new Error("You can edit only your own post.");
  if (post.deletedAt) throw new Error("Deleted posts cannot be edited.");
  const normalizedBody = body.trim();
  if (post.body === normalizedBody) return { ...post };
  const editedAt = new Date().toISOString();
  threadPostRevisions.push({
    id: makeId("thread-revision"),
    postId,
    body: post.body,
    createdAt: editedAt,
  });
  post.body = normalizedBody;
  post.editedAt = editedAt;
  const thread = getThreadById(post.threadId);
  if (thread) thread.updatedAt = editedAt;
  persistState();
  return { ...post };
}

export function deleteThreadPost(
  postId: string,
  profileId = currentProfile().id,
): ThreadPost {
  const post = getThreadPostById(postId);
  if (!post) throw new Error("Post does not exist.");
  if (!canManageThreadPost(post, profileId))
    throw new Error("You can delete only your own post.");
  if (post.deletedAt) return { ...post };
  const deletedAt = new Date().toISOString();
  threadPostRevisions.push({
    id: makeId("thread-revision"),
    postId,
    body: post.body,
    createdAt: deletedAt,
  });
  post.body = "";
  post.deletedAt = deletedAt;
  post.editedAt = deletedAt;
  const thread = getThreadById(post.threadId);
  if (thread?.bestAnswerPostId === postId) {
    delete thread.bestAnswerPostId;
    delete thread.solvedAt;
  }
  persistState();
  return { ...post };
}

export function getThreadPostRevisions(
  postId: string,
  profileId = currentProfile().id,
): ThreadPostRevision[] {
  const post = getThreadPostById(postId);
  if (!post) throw new Error("Post does not exist.");
  if (!canManageThreadPost(post, profileId))
    throw new Error("You can view history only for your own post.");
  return threadPostRevisions
    .filter((item) => item.postId === postId)
    .map((item) => ({ ...item }));
}

function isThreadAuthorBlocked(
  ownerProfileId: string,
  targetProfileId: string | null,
) {
  return Boolean(
    targetProfileId &&
    threadUserControls.some(
      (item) =>
        item.ownerProfileId === ownerProfileId &&
        item.targetProfileId === targetProfileId &&
        item.blocked,
    ),
  );
}

function getBookmarkForTarget(
  targetType: BookmarkItem["targetType"],
  targetId: string,
  profileId: string,
) {
  return bookmarks.find(
    (bookmark) =>
      bookmark.targetType === targetType &&
      bookmark.targetId === targetId &&
      bookmark.id.startsWith(`bookmark-${profileId}-`),
  );
}

export function getEngagementSummary(
  targetType: EngagementTargetType,
  targetId: string,
  profileId = currentProfile().id,
): EngagementSummary {
  const targetReactions = reactions.filter(
    (reaction) =>
      reaction.targetType === targetType && reaction.targetId === targetId,
  );
  const likeCount = targetReactions.filter(
    (reaction) => reaction.kind === "like",
  ).length;
  const viewerReaction = targetReactions.some(
    (reaction) => reaction.profileId === profileId && reaction.kind === "like",
  )
    ? "like"
    : null;
  const bookmarked = Boolean(
    getBookmarkForTarget(targetType, targetId, profileId),
  );
  const bookmarkCount = bookmarks.filter(
    (b) => b.targetType === targetType && b.targetId === targetId,
  ).length;
  const replyCount =
    targetType === "social_post"
      ? getRepliesForSocialPost(targetId).length
      : targetType === "thread_post"
        ? threadPosts.filter((post) => post.replyToPostId === targetId).length
        : targetType === "community_message"
          ? communityChannelMessages.filter(
              (message) => message.replyToMessageId === targetId,
            ).length
          : 0;
  const repostCount =
    targetType === "vault_content"
      ? 0
      : socialPosts.filter(
          (post) =>
            post.repostOfTargetType === targetType &&
            post.repostOfTargetId === targetId,
        ).length;
  const quoteRepostCount =
    targetType === "vault_content"
      ? 0
      : socialPosts.filter(
          (post) =>
            post.quoteOfTargetType === targetType &&
            post.quoteOfTargetId === targetId,
        ).length;
  return {
    targetType,
    targetId,
    replyCount,
    repostCount,
    quoteRepostCount,
    likeCount,
    score: calculateEngagementScore({
      replyCount,
      repostCount,
      quoteRepostCount,
      likeCount,
      bookmarkCount,
    }),
    bookmarked,
    viewerReaction,
  };
}

export function getThreadRanking() {
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const candidates = getThreads().map((thread) => {
    const recentPosts = getPostsForThread(thread.id).filter(
      (post) => new Date(post.createdAt).getTime() >= recentThreshold,
    );
    return {
      ...thread,
      recentPostCount: recentPosts.length,
      recentParticipantCount: new Set(
        recentPosts.map(
          (post) => post.authorProfileId ?? `anonymous:${post.displayName}`,
        ),
      ).size,
    };
  });
  return rankPopularThreads(candidates).map((thread) => ({
    thread,
    board: getBoardByKey(thread.boardKey),
    momentum: Number(calculateThreadRankScore(thread).toFixed(1)),
  }));
}

export function getSocialRanking() {
  return rankSocialTrends(
    getTopLevelSocialPosts().map((post) => ({
      ...getEngagementSummary("social_post", post.id),
      post,
      authorProfileId: post.authorProfileId,
      createdAt: post.createdAt,
    })),
  ).map((entry) => ({
    post: entry.post,
    replyCount: entry.replyCount,
    repostCount: entry.repostCount + entry.quoteRepostCount,
    likeCount: entry.likeCount,
    score: Number(calculateSocialTrendScore(entry).toFixed(1)),
  }));
}

export function getTokenRanking(symbol: string) {
  return profiles
    .map((profile) => ({
      profile,
      balance:
        getTokenBalances(profile.id).find((entry) => entry.symbol === symbol)
          ?.amount ?? 0,
    }))
    .sort((left, right) => right.balance - left.balance);
}

export function getProfileByHandle(handle: string): Profile | undefined {
  return profiles.find((profile) => profile.handle === handle);
}

export function getProfileById(profileId: string): Profile | undefined {
  return profiles.find((profile) => profile.id === profileId);
}

export function getCurrentProfile(): Profile {
  return currentProfile();
}

export function updateProfileAvatar(
  profileId: string,
  avatarUrl: string,
): Profile {
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");
  profile.avatarUrl = avatarUrl;
  persistState();
  return { ...profile };
}

export function updateProfile(
  profileId: string,
  input: { displayName: string; bio: string },
): Profile {
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");

  const displayName = input.displayName.trim();
  const bio = input.bio.trim();

  if (!displayName) {
    throw new Error("Display name is required.");
  }

  if (displayName.length > 40) {
    throw new Error("Display name must be 40 characters or less.");
  }

  if (bio.length > 180) {
    throw new Error("Bio must be 180 characters or less.");
  }

  profile.displayName = displayName;
  profile.bio = bio;
  persistState();
  return { ...profile };
}

export function getNotifications(
  receiverProfileId = currentProfile().id,
): Notification[] {
  return notifications
    .filter(
      (notification) => notification.receiverProfileId === receiverProfileId,
    )
    .map((notification) => notification.type === "social_reaction"
      ? { ...notification, actorProfileId: null, text: "投稿にいいねが付きました。" }
      : notification)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getFollows(): FollowRelation[] {
  return [...follows];
}

export function isFollowing(
  followerProfileId: string,
  followedProfileId: string,
): boolean {
  return follows.some(
    (relation) =>
      relation.followerProfileId === followerProfileId &&
      relation.followedProfileId === followedProfileId,
  );
}

export function getFollowerCount(profileId: string): number {
  return follows.filter((relation) => relation.followedProfileId === profileId)
    .length;
}

export function getFollowingCount(profileId: string): number {
  return follows.filter((relation) => relation.followerProfileId === profileId)
    .length;
}

export function getUnreadNotificationCount(
  receiverProfileId = currentProfile().id,
): number {
  return getNotifications(receiverProfileId).filter(
    (notification) => !notification.isRead,
  ).length;
}

export function markAllNotificationsRead(
  receiverProfileId = currentProfile().id,
): Notification[] {
  for (const notification of notifications) {
    if (notification.receiverProfileId === receiverProfileId) {
      notification.isRead = true;
    }
  }

  persistState();
  return getNotifications(receiverProfileId);
}

export function markNotificationRead(
  notificationId: string,
): Notification | undefined {
  const notification = notifications.find(
    (entry) => entry.id === notificationId,
  );

  if (notification) {
    notification.isRead = true;
    persistState();
  }

  return notification;
}

export function getConversations(
  profileId = currentProfile().id,
): MessageConversation[] {
  return conversations
    .filter((conversation) => conversation.participantIds.includes(profileId))
    .sort((left, right) =>
      right.lastMessageAt.localeCompare(left.lastMessageAt),
    );
}

export function getConversationById(
  conversationId: string,
): MessageConversation | undefined {
  return conversations.find(
    (conversation) => conversation.id === conversationId,
  );
}

export function getMessagesForConversation(
  conversationId: string,
): DirectMessage[] {
  return messages
    .filter((message) => message.conversationId === conversationId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getAllMessages(): DirectMessage[] {
  return [...messages].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function startDirectMessage(targetProfileId: string) {
  const me = currentProfile();
  const targetProfile = getProfileById(targetProfileId);

  if (!targetProfile) {
    throw new Error("Target profile does not exist.");
  }

  const existingConversation = conversations.find((conversation) => {
    return (
      conversation.participantIds.length === 2 &&
      conversation.participantIds.includes(me.id) &&
      conversation.participantIds.includes(targetProfileId)
    );
  });

  if (existingConversation) {
    return {
      conversation: existingConversation,
      createdNew: false,
    };
  }

  const fingerprint =
    "UNVERIFIED:" + targetProfile.handle.slice(0, 4).toUpperCase();
  const createdConversation: MessageConversation = {
    id: makeId("conv"),
    participantIds: [me.id, targetProfileId],
    isE2ee: true,
    verificationStatus: "unverified",
    fingerprint,
    unreadCountByProfileId: {
      [me.id]: 0,
      [targetProfileId]: 0,
    },
    lastMessageAt: new Date().toISOString(),
  };

  conversations.unshift(createdConversation);
  persistState();

  return {
    conversation: createdConversation,
    createdNew: true,
  };
}

export function toggleFollow(
  targetProfileId: string,
  followerProfileId = currentProfile().id,
) {
  if (!targetProfileId || targetProfileId === followerProfileId) {
    throw new Error("Invalid follow target.");
  }

  const existingIndex = follows.findIndex(
    (relation) =>
      relation.followerProfileId === followerProfileId &&
      relation.followedProfileId === targetProfileId,
  );

  if (existingIndex >= 0) {
    follows.splice(existingIndex, 1);
    persistState();

    return {
      following: false,
      followerCount: getFollowerCount(targetProfileId),
      followingCount: getFollowingCount(followerProfileId),
    };
  }

  follows.push({
    followerProfileId,
    followedProfileId: targetProfileId,
  });

  const actor = getProfileById(followerProfileId);
  const createdAt = new Date().toISOString();

  notifications.unshift({
    id: makeId("notif"),
    receiverProfileId: targetProfileId,
    actorProfileId: followerProfileId,
    type: "followed",
    targetType: "profile",
    targetId: targetProfileId,
    text: `${actor?.displayName ?? "Unknown"} があなたをフォローしました。`,
    isRead: false,
    createdAt,
  });

  persistState();

  return {
    following: true,
    followerCount: getFollowerCount(targetProfileId),
    followingCount: getFollowingCount(followerProfileId),
  };
}

export function markConversationRead(
  conversationId: string,
  profileId = currentProfile().id,
) {
  const conversation = getConversationById(conversationId);

  if (!conversation) {
    return undefined;
  }

  conversation.unreadCountByProfileId[profileId] = 0;
  persistState();
  return conversation;
}

export function updateConversationVerification(
  conversationId: string,
  status: VerificationStatus,
  fingerprint?: string,
) {
  const conversation = getConversationById(conversationId);

  if (!conversation) {
    return undefined;
  }

  conversation.verificationStatus = status;

  if (fingerprint) {
    conversation.fingerprint = fingerprint;
  }

  persistState();
  return conversation;
}

export function sendMessage(input: {
  conversationId: string;
  senderProfileId?: string;
  encryptedPayload: string;
  previewText: string;
  encryptionVersion?: string;
}) {
  const me = currentProfile();
  const senderProfileId = input.senderProfileId ?? me.id;
  const conversation = getConversationById(input.conversationId);

  if (!conversation) {
    throw new Error("Conversation does not exist.");
  }

  const createdAt = new Date().toISOString();
  const createdMessage: DirectMessage = {
    id: makeId("msg"),
    conversationId: input.conversationId,
    senderProfileId,
    encryptedPayload: input.encryptedPayload,
    previewText: input.previewText,
    encryptionVersion: input.encryptionVersion ?? "proto-e2ee-v1",
    encryptionState: "sealed",
    createdAt,
  };

  messages.push(createdMessage);
  conversation.lastMessageAt = createdAt;

  for (const participantId of conversation.participantIds) {
    if (participantId !== senderProfileId) {
      conversation.unreadCountByProfileId[participantId] =
        (conversation.unreadCountByProfileId[participantId] ?? 0) + 1;
    }
  }

  const sender = getProfileById(senderProfileId);

  for (const participantId of conversation.participantIds) {
    if (participantId !== senderProfileId) {
      notifications.unshift({
        id: makeId("notif"),
        receiverProfileId: participantId,
        actorProfileId: senderProfileId,
        type: "message_received",
        targetType: "message_conversation",
        targetId: conversation.id,
        text: `${sender?.displayName ?? "Unknown"} から暗号化メッセージが届きました。`,
        isRead: false,
        createdAt,
      });
    }
  }

  persistState();
  return createdMessage;
}

export function createSocialPost(input: {
  body: string;
  identityMode?: SocialPost["identityMode"];
  authorProfileId?: string | null;
  replyToPostId?: string | null;
  repostOfTargetType?: SocialPost["repostOfTargetType"];
  repostOfTargetId?: string | null;
  quoteOfTargetType?: SocialPost["quoteOfTargetType"];
  quoteOfTargetId?: string | null;
}) {
  const me = currentProfile();
  const authorProfileId =
    input.identityMode === "guest" ? null : (input.authorProfileId ?? me.id);
  const author = authorProfileId ? getProfileById(authorProfileId) : undefined;
  const createdAt = new Date().toISOString();
  if (input.repostOfTargetType && input.repostOfTargetId) {
    const previous = socialPosts
      .filter((post) => post.authorProfileId === authorProfileId && post.repostOfTargetType === input.repostOfTargetType && post.repostOfTargetId === input.repostOfTargetId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (previous && Date.parse(createdAt) - Date.parse(previous.createdAt) < 24 * 60 * 60 * 1000) {
      throw new RepostCooldownError(repostRetryAt(previous.createdAt));
    }
  }
  const createdPost: SocialPost = {
    id: makeId("social"),
    authorProfileId,
    displayName:
      input.identityMode === "guest"
        ? "Guest"
        : (author?.displayName ?? me.displayName),
    handle:
      input.identityMode === "account" && author?.handle
        ? author.handle
        : undefined,
    identityMode: input.identityMode ?? "account",
    body: input.body,
    createdAt,
    replyToPostId: input.replyToPostId ?? null,
    repostOfTargetType: input.repostOfTargetType ?? null,
    repostOfTargetId: input.repostOfTargetId ?? null,
    quoteOfTargetType: input.quoteOfTargetType ?? null,
    quoteOfTargetId: input.quoteOfTargetId ?? null,
  };

  socialPosts.push(createdPost);

  if (createdPost.replyToPostId) {
    const target = socialPosts.find(
      (post) => post.id === createdPost.replyToPostId,
    );

    if (target?.authorProfileId && target.authorProfileId !== authorProfileId) {
      notifyIfExternal({
        receiverProfileId: target.authorProfileId,
        actorProfileId: authorProfileId,
        type: "social_reply",
        targetType: "social_post",
        targetId: target.id,
        text: `${createdPost.displayName} replied to your post.`,
        createdAt,
      });
    }
  }

  const repostTargetType =
    createdPost.repostOfTargetType ?? createdPost.quoteOfTargetType;
  const repostTargetId =
    createdPost.repostOfTargetId ?? createdPost.quoteOfTargetId;

  if (
    repostTargetId &&
    (repostTargetType === "social_post" ||
      repostTargetType === "thread_post" ||
      repostTargetType === "vault_content")
  ) {
    const receiverProfileId = getEngagementTargetOwner(
      repostTargetType,
      repostTargetId,
    );
    const isQuote = Boolean(
      createdPost.quoteOfTargetType && createdPost.quoteOfTargetId,
    );

    notifyIfExternal({
      receiverProfileId,
      actorProfileId: authorProfileId,
      type: "social_repost",
      targetType: repostTargetType,
      targetId: repostTargetId,
      text: `${createdPost.displayName} ${isQuote ? "quoted" : "reposted"} your post.`,
      createdAt,
    });
  }

  persistState();
  return createdPost;
}

export function createThread(input: {
  boardKey: string;
  title: string;
  body: string;
  identityMode?: "anonymous" | "account";
  authorProfileId?: string;
  language?: import("@/lib/thread-scope").ThreadLanguage;
  region?: import("@/lib/thread-scope").ThreadRegion;
  threadType?: import("@/lib/thread-type").ThreadType;
  deadline?: string | null;
  tags?: string[];
}) {
  const me = currentProfile();
  const normalizedBoardKey = normalizeBoardKey(input.boardKey);
  const board = getBoardByKey(normalizedBoardKey);

  if (!board) {
    throw new Error("Board does not exist.");
  }
  const identityMode = input.identityMode ?? "account";
  const author = getProfileById(input.authorProfileId ?? me.id) ?? me;
  const authorProfileId = author.id;
  const isAnonymous = identityMode === "anonymous";
  const displayName = isAnonymous ? "名無しさん" : author.displayName;

  const createdAt = new Date().toISOString();
  const threadId = makeId("thread");

  const createdThread: ThreadSummary = {
    id: threadId,
    boardKey: normalizedBoardKey,
    title: input.title,
    postCount: 1,
    updatedAt: createdAt,
    language: input.language ?? "ja",
    region: input.region ?? "global",
    threadType: input.threadType ?? "chat",
    deadline: input.deadline ?? undefined,
    tags: input.tags ?? [],
    slowModeSeconds: 0,
  };

  const createdPost: ThreadPost = {
    id: makeId(`${threadId}-post`),
    threadId,
    no: 1,
    authorProfileId,
    displayName,
    body: input.body,
    createdAt,
    isAnonymous,
  };

  threads.unshift(createdThread);
  threadPosts.push(createdPost);
  syncBoardThreadCounts(boards, threads);
  persistState();

  return {
    thread: createdThread,
    post: createdPost,
  };
}

export function createThreadReply(input: {
  threadId: string;
  body: string;
  identityMode?: ThreadIdentityMode;
  displayName?: string;
  authorProfileId?: string;
  replyToPostId?: string | null;
}) {
  const me = currentProfile();
  const identityMode = input.identityMode ?? "anonymous";
  const thread = getThreadById(input.threadId);

  if (!thread) {
    throw new Error("Thread does not exist.");
  }
  const author = getProfileById(input.authorProfileId ?? me.id) ?? me;
  const authorProfileId = author.id;
  const isAnonymous = identityMode === "anonymous";
  const displayName = isAnonymous ? "名無しさん" : author.displayName;

  const createdAt = new Date().toISOString();
  const nextNo =
    Math.max(
      0,
      ...threadPosts
        .filter((post) => post.threadId === input.threadId)
        .map((post) => post.no),
    ) + 1;

  const createdPost: ThreadPost = {
    id: makeId(`${input.threadId}-post`),
    threadId: input.threadId,
    no: nextNo,
    authorProfileId,
    displayName,
    body: input.body,
    createdAt,
    isAnonymous,
    replyToPostId: input.replyToPostId ?? null,
  };

  threadPosts.push(createdPost);
  thread.postCount += 1;
  thread.updatedAt = createdAt;

  if (authorProfileId) {
    const targetPost = input.replyToPostId
      ? getThreadPostById(input.replyToPostId)
      : threadPosts.find(
          (post) => post.threadId === input.threadId && post.no === 1,
        );

    notifyIfExternal({
      receiverProfileId: targetPost?.authorProfileId,
      actorProfileId: isAnonymous ? null : authorProfileId,
      type: "thread_reply",
      targetType: "thread_post",
      targetId: targetPost?.id ?? createdPost.id,
      text: `${displayName} replied in your thread.`,
      createdAt,
    });
  }

  const directlyNotifiedProfileId = input.replyToPostId
    ? getThreadPostById(input.replyToPostId)?.authorProfileId
    : threadPosts.find(
        (post) => post.threadId === input.threadId && post.no === 1,
      )?.authorProfileId;
  for (const tracking of threadTracking) {
    if (
      !tracking.following ||
      tracking.threadId !== input.threadId ||
      tracking.profileId === authorProfileId ||
      tracking.profileId === directlyNotifiedProfileId ||
      isThreadAuthorBlocked(tracking.profileId, authorProfileId)
    )
      continue;
    notifyIfExternal({
      receiverProfileId: tracking.profileId,
      actorProfileId: isAnonymous ? null : authorProfileId,
      type: "thread_reply",
      targetType: "thread_post",
      targetId: createdPost.id,
      text: `${thread.title} に新しい返信があります。`,
      createdAt,
    });
  }

  persistState();
  return createdPost;
}

export function toggleReaction(input: {
  targetType: EngagementTargetType;
  targetId: string;
  kind: ReactionKind;
  profileId?: string;
}) {
  const profileId = input.profileId ?? currentProfile().id;
  const createdAt = new Date().toISOString();
  if (input.targetType === "community_message") {
    requireCommunityMessageEngagementTarget(input.targetId, profileId);
  }
  let shouldNotify = false;
  const existingIndex = reactions.findIndex(
    (reaction) =>
      reaction.targetType === input.targetType &&
      reaction.targetId === input.targetId &&
      reaction.profileId === profileId,
  );

  if (existingIndex >= 0) {
    const existing = reactions[existingIndex];

    if (existing.kind === input.kind) {
      reactions.splice(existingIndex, 1);
    } else {
      reactions[existingIndex] = {
        ...existing,
        kind: input.kind,
        createdAt,
      };
      shouldNotify = true;
    }
  } else {
    reactions.push({
      id: makeId("reaction"),
      targetType: input.targetType,
      targetId: input.targetId,
      profileId,
      kind: input.kind,
      createdAt,
    });
    shouldNotify = true;
  }

  if (shouldNotify && input.targetType !== "community_message") {
    notifyIfExternal({
      receiverProfileId: getEngagementTargetOwner(
        input.targetType,
        input.targetId,
      ),
      actorProfileId: null,
      type: "social_reaction",
      targetType: input.targetType,
      targetId: input.targetId,
      text: "投稿にいいねが付きました。",
      createdAt,
    });
  }

  persistState();
  return getEngagementSummary(input.targetType, input.targetId, profileId);
}

export function toggleBookmark(input: {
  targetType: BookmarkItem["targetType"];
  targetId: string;
  profileId?: string;
  note?: string;
}) {
  const profileId = input.profileId ?? currentProfile().id;
  if (input.targetType === "community_message") {
    requireCommunityMessageEngagementTarget(input.targetId, profileId);
  }
  const existing = getBookmarkForTarget(
    input.targetType,
    input.targetId,
    profileId,
  );

  if (existing) {
    const index = bookmarks.findIndex(
      (bookmark) => bookmark.id === existing.id,
    );
    bookmarks.splice(index, 1);
  } else {
    bookmarks.unshift({
      id: `bookmark-${profileId}-${input.targetType}-${input.targetId}`,
      targetType: input.targetType,
      targetId: input.targetId,
      note: input.note ?? "",
    });
  }

  persistState();

  if (
    input.targetType === "social_post" ||
    input.targetType === "thread_post" ||
    input.targetType === "community_message" ||
    input.targetType === "vault_content"
  ) {
    return getEngagementSummary(input.targetType, input.targetId, profileId);
  }

  return null;
}

export function moveList(listId: string, direction: "up" | "down") {
  const ordered = getLists();
  const currentIndex = ordered.findIndex((list) => list.id === listId);

  if (currentIndex === -1) {
    throw new Error("List does not exist.");
  }

  const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (swapIndex < 0 || swapIndex >= ordered.length) {
    return getLists();
  }

  const current = ordered[currentIndex];
  const target = ordered[swapIndex];

  current.order = swapIndex;
  target.order = currentIndex;

  persistState();

  return getLists();
}

export function getSnapshot(): AppSnapshot {
  return {
    currentProfile: currentProfile(),
    profiles: getProfiles(),
    communities: getCommunities(),
    communityMemberships: getCommunityMemberships(),
    communityTokens: getCommunityTokens(),
    communityChannels: getCommunityChannels(),
    communityChannelMessages: communityChannels.flatMap((channel) =>
      getCommunityChannelMessages(channel.id),
    ),
    communityChannelReactions: getCommunityChannelReactions(),
    communityChannelReadStates: getCommunityChannelReadStates(),
    communityGuideDirectories: getCommunityGuideDirectories(),
    communityGuidePages: getCommunityGuidePages(),
    communityGuideProposals: getCommunityGuideProposals(),
    communityGuideReviews: getCommunityGuideReviews(),
    communityGovernanceProposals: getCommunityGovernanceProposals(),
    communityGovernanceVotes: getCommunityGovernanceVotes(),
    boards: getBoards(),
    threads: getThreads(),
    threadTracking: structuredClone(threadTracking),
    threadPosts: threadPosts.map(toPublicThreadPost),
    threadPostRevisions: [],
    threadPostReports: [],
    threadUserControls: [],
    socialPosts: getSocialPosts(),
    tokenBalances,
    tokenRankings: getTokenRankings(),
    lists: getLists(),
    bookmarks: getBookmarks(),
    reactions: getReactions(),
    follows: getFollows(),
    notifications: getNotifications(),
    conversations: getConversations(),
    messages: [...messages],
  };
}
