import { canonicalHubpediaSlug } from "./article-aliases";
import { getArticleCategoryIds, getEncyclopediaCategoryPath } from "./categories";
import type { ViewableSeedArticle } from "./seed";
import { getAutomaticArticleTags } from "./automatic-tags";

const articleLinkPattern = /\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;
const latinWordPattern=/[a-z0-9][a-z0-9+-]{2,}/giu;
const cjkRunPattern=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu;
const genericConcepts=new Set(["について","における","として","される","である","概要","関連","記事","仕組み","背景","具体例","出典","情報"]);

function conceptText(article:ViewableSeedArticle){
 const headings=[...article.bodyMarkdown.matchAll(/^#{2,3}\s+(.+)$/gmu)].map(match=>match[1]).join(" ");
 return `${article.title} ${article.summary??""} ${article.categoryLabel} ${headings}`.normalize("NFKC").toLocaleLowerCase("ja");
}

export function getArticleConcepts(article:ViewableSeedArticle){
 const text=conceptText(article),concepts=new Set<string>();
 for(const match of text.matchAll(latinWordPattern))concepts.add(match[0].toLowerCase());
 for(const match of text.matchAll(cjkRunPattern)){
  const run=match[0];if(run.length<=8&&!genericConcepts.has(run))concepts.add(run);
  for(let index=0;index<run.length-1;index+=1){const gram=run.slice(index,index+2);if(!genericConcepts.has(gram))concepts.add(gram);}
 }
 return concepts;
}

function semanticRelationScore(left:Set<string>,right:Set<string>){
 let shared=0;for(const concept of left)if(right.has(concept))shared+=concept.length>=3?2:1;
 return shared/Math.max(4,Math.sqrt(left.size*right.size));
}

export function getLinkedArticleSlugs(markdown: string) {
  return new Set(
    Array.from(markdown.matchAll(articleLinkPattern), (match) => canonicalHubpediaSlug(match[1])),
  );
}

export function getRelatedSeedArticles(
  article: ViewableSeedArticle,
  articles: readonly ViewableSeedArticle[],
  limit = 6,
) {
  return getRelatedSeedArticlesWithReasons(article,articles,limit).map(({article:related})=>related);
}

/*
 * Below this, a shared concept is two articles happening to use the same
 * ordinary word. The highest overlap in the published set is 0.180 and the
 * median is 0.038, so this keeps the real pairs and drops the coincidences.
 */
const UNCATEGORIZED = "maintenance/uncategorized";
const MINIMUM_CONCEPT_OVERLAP = 0.1;

export function getRelatedSeedArticlesWithReasons(
  article: ViewableSeedArticle,
  articles: readonly ViewableSeedArticle[],
  limit = 6,
) {
  const outgoingLinks = getLinkedArticleSlugs(article.bodyMarkdown);
  const articleCategories = new Set(getArticleCategoryIds(article));
  const articleConcepts=getArticleConcepts(article);
  const articleTags=new Set(getAutomaticArticleTags(article,articles).map(tag=>tag.normalize("NFKC").toLocaleLowerCase("ja")));

  return articles
    .filter((candidate) => candidate.slug !== article.slug)
    .map((candidate) => {
      const candidateLinks = getLinkedArticleSlugs(candidate.bodyMarkdown);
      /*
       * Both being unfiled is not something they share. Every article that
       * matches no rule lands in maintenance/uncategorized, so counting it
       * would make the whole unfiled backlog mutually related.
       */
      const sharedCategories = getArticleCategoryIds(candidate)
        .filter((categoryId) => categoryId !== UNCATEGORIZED && articleCategories.has(categoryId))
        .length;
      const semanticScore=semanticRelationScore(articleConcepts,getArticleConcepts(candidate));
      const matchingTags=getAutomaticArticleTags(candidate,articles).filter(tag=>articleTags.has(tag.normalize("NFKC").toLocaleLowerCase("ja")));
      const sharedTags=matchingTags.length;
      const score =
        semanticScore*40
        + sharedTags*14
        + (outgoingLinks.has(candidate.slug) ? 18 : 0)
        + (candidateLinks.has(article.slug) ? 12 : 0)
        + sharedCategories * 8
        + (candidate.topicType === article.topicType ? 3 : 0);
      const sharedCategoryId=getArticleCategoryIds(candidate).find((categoryId)=>categoryId!==UNCATEGORIZED&&articleCategories.has(categoryId));
      const categoryName=sharedCategoryId?getEncyclopediaCategoryPath(sharedCategoryId).at(-1)?.name:undefined;
      const comparisonPattern=new RegExp(`(?:比較|対立|違い|対照|compare|contrast|versus)[^。.!?]{0,80}${candidate.title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}|${candidate.title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}[^。.!?]{0,80}(?:比較|対立|違い|対照|compare|contrast|versus)`,`iu`);
      const relationType=comparisonPattern.test(article.bodyMarkdown)
        ? "comparison" as const
        : outgoingLinks.has(candidate.slug)
          ? "prerequisite" as const
          : candidateLinks.has(article.slug)
            ? "development" as const
            : "same-field" as const;
      const reason=outgoingLinks.has(candidate.slug)
        ? "本文で参照"
        : candidateLinks.has(article.slug)
          ? "相互に関連"
          : matchingTags[0]
            ? `共通概念: ${matchingTags[0]}`
            : categoryName
              ? `同じ分野: ${categoryName}`
              : "主題が関連";
      /*
       * Something the two articles actually share. Measured over the ten
       * published articles, only four of the ninety pairs share a tag, a link
       * or a category, and the concept overlap is 0.038 at the median — noise
       * from ordinary words. Passing anything above zero meant 遺伝学 listed
       * アフリカゾウ, 自由主義 and 寿司 as related, and the topicType
       * tiebreaker alone was enough to put them there.
       */
      const evidence = sharedTags > 0
        || outgoingLinks.has(candidate.slug)
        || candidateLinks.has(article.slug)
        || sharedCategories > 0
        || semanticScore >= MINIMUM_CONCEPT_OVERLAP;
      return { article: candidate, score, reason, relationType, evidence };
    })
    .filter(({ score, evidence }) => score > 0 && evidence)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title, "ja"))
    .slice(0, limit)
    .map(({ article: candidate,reason,relationType }) => ({article:candidate,reason,relationType}));
}
