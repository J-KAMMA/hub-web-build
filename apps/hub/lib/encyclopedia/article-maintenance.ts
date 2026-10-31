import { getLinkedArticleSlugs } from "./article-relations";
import { assessArticleQuality } from "./article-quality-engine";
import { inferArticleEntityType } from "./article-structure-policy";
import type { ViewableSeedArticle } from "./seed";
import { auditCategoryGovernance } from "./category-governance";
import { buildPublicationOperationsReport } from "./publication-operations";

export type FreshnessClass = "rapid" | "periodic" | "stable";
export type TranslationParityIssue = { slug:string; locale:string; code:"section_count"|"citation_count"|"link_targets"|"numbers" };
export type ContradictionCandidate = { anchor:string; values:string[]; slugs:string[] };

function count(value:string,pattern:RegExp){return [...value.matchAll(pattern)].length;}
function values(value:string,pattern:RegExp){return [...value.matchAll(pattern)].map((match)=>match[1]).sort();}
function same(left:readonly string[],right:readonly string[]){return left.length===right.length&&left.every((value,index)=>value===right[index]);}
function significantNumbers(markdown:string){
  const prose=markdown
    .replace(/\\?\[\d+\\?\]/g,"")
    .replace(/https?:\/\/[^\s)\]]+/g,"")
    .replace(/\]\([^)]+\)/g,"]");
  return values(prose,/(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/gu).map((value)=>value.replaceAll(",","")).sort();
}

export function freshnessPolicy(article:ViewableSeedArticle){
  const text=`${article.title} ${article.topicType} ${article.categoryLabel}`.toLocaleLowerCase("ja");
  const entity=inferArticleEntityType(article);
  const freshnessClass:FreshnessClass=/(現在|現職|価格|規制|法律|医療|選挙|ランキング|current|price|law|medical|election)/iu.test(text)?"rapid":entity==="technology"||entity==="science"?"periodic":"stable";
  const maxAgeDays=freshnessClass==="rapid"?90:freshnessClass==="periodic"?365:1825;
  return {freshnessClass,maxAgeDays};
}

export function translationParityIssues(article:ViewableSeedArticle):TranslationParityIssue[]{
  const issues:TranslationParityIssue[]=[];
  for(const [locale,translation] of Object.entries(article.translations??{})){
    if(Math.abs(count(article.bodyMarkdown,/^##\s+/gmu)-count(translation.bodyMarkdown,/^##\s+/gmu))>1)issues.push({slug:article.slug,locale,code:"section_count"});
    if(count(article.bodyMarkdown,/\\?\[\d+\\?\]/g)!==count(translation.bodyMarkdown,/\\?\[\d+\\?\]/g))issues.push({slug:article.slug,locale,code:"citation_count"});
    if(!same(values(article.bodyMarkdown,/\]\(\/hubpedia\/([a-z0-9-]+)\)/g),values(translation.bodyMarkdown,/\]\(\/hubpedia\/([a-z0-9-]+)\)/g)))issues.push({slug:article.slug,locale,code:"link_targets"});
    if(!same(significantNumbers(article.bodyMarkdown),significantNumbers(translation.bodyMarkdown)))issues.push({slug:article.slug,locale,code:"numbers"});
  }
  return issues;
}

export function findContradictionCandidates(articles:readonly ViewableSeedArticle[]):ContradictionCandidate[]{
  const claims=new Map<string,Map<string,Set<string>>>();
  for(const article of articles)for(const sentence of `${article.summary} ${article.bodyMarkdown}`.split(/[。.!?]\s*/u))for(const match of sentence.matchAll(/(.{2,24}?)(\d{3,4}(?:年|年代)?)/gu)){
    const anchor=match[1].normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu,"").slice(-16);if(anchor.length<2)continue;
    const byValue=claims.get(anchor)??new Map<string,Set<string>>(),slugs=byValue.get(match[2])??new Set<string>();slugs.add(article.slug);byValue.set(match[2],slugs);claims.set(anchor,byValue);
  }
  return [...claims].filter(([,byValue])=>byValue.size>1).map(([anchor,byValue])=>({anchor,values:[...byValue.keys()],slugs:[...new Set([...byValue.values()].flatMap((set)=>[...set]))]}));
}

export function findDisambiguationGroups(articles:readonly ViewableSeedArticle[]){
  const groups=new Map<string,ViewableSeedArticle[]>();
  for(const article of articles){const key=article.title.normalize("NFKC").replace(/[（(].+?[）)]/gu,"").replace(/\s+/g,"").toLocaleLowerCase("ja"),group=groups.get(key)??[];group.push(article);groups.set(key,group);}
  return [...groups.entries()].filter(([,group])=>group.length>1).map(([term,group])=>({term,articles:group.map(({slug,title,categoryLabel})=>({slug,title,categoryLabel}))}));
}

export function visualRecommendation(article:ViewableSeedArticle){
  const entity=inferArticleEntityType(article);
  const kind=entity==="place"?"map":entity==="organism"||entity==="person"?"licensed-image":entity==="technology"||entity==="science"?"diagram":entity==="history"?"timeline":"none";
  return {kind,required:kind!=="none",licenseRequirement:kind==="licensed-image"?"commercial-reuse-compatible":"original-or-commercial-reuse-compatible"};
}

export function improvementPriority(input:{views:number;searchExits:number;relatedClicks:number;averageDwellSeconds:number;qualityScore:number}){
  const demand=Math.log10(Math.max(1,input.views)+1)*20,exitRate=input.views?input.searchExits/input.views:0,relatedRate=input.views?input.relatedClicks/input.views:0,dwellPenalty=input.averageDwellSeconds<30?15:input.averageDwellSeconds<60?7:0,qualityGap=95-input.qualityScore;
  return Math.round(demand+exitRate*35-relatedRate*10+dwellPenalty+qualityGap);
}

export function buildMaintenanceReport(articles:readonly ViewableSeedArticle[]){
  return {
    quality:articles.map((article)=>({slug:article.slug,...assessArticleQuality(article)})),
    freshness:articles.map((article)=>({slug:article.slug,...freshnessPolicy(article)})),
    translationParity:articles.flatMap(translationParityIssues),
    contradictionCandidates:findContradictionCandidates(articles),
    disambiguationGroups:findDisambiguationGroups(articles),
    prerequisites:articles.map((article)=>({slug:article.slug,slugs:[...getLinkedArticleSlugs(article.bodyMarkdown)].slice(0,3)})),
    visuals:articles.map((article)=>({slug:article.slug,...visualRecommendation(article)})),
    categoryGovernance:auditCategoryGovernance(articles),
    operations:buildPublicationOperationsReport(articles),
  };
}
