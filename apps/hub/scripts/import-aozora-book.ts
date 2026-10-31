import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as cheerio from "cheerio";

type Section = { id: string; heading: string; paragraphs: string[] };
type Chapter = { slug: string; title: string; lead: string; sections: Section[] };
const SOURCE = "https://www.aozora.gr.jp/cards/000148/files/773_14560.html";
const CARD = "https://www.aozora.gr.jp/cards/000148/card773.html";

type BookPreset = {
  id: string; title: string; author: string; description: string; card: string; source: string;
  baseEdition: string; publisher: string; sourceEditionDate: string; proofEditionDate: string;
  inputBy: string; proofreadBy: string; reportingNotice?: string;
};

const PRESETS: Record<string, BookPreset> = {
  kokoro: { id: "kokoro", title: "こころ", author: "夏目漱石", description: "「先生」と私の交流を通して、人間の孤独と罪、明治の精神を描いた長編小説。", card: CARD, source: SOURCE, baseEdition: "こころ", publisher: "集英社文庫、集英社", sourceEditionDate: "1995-06-14（第10刷）", proofEditionDate: "1996-06-30（第14刷）", inputBy: "j.utiyama", proofreadBy: "伊藤時也" },
  "ginga-tetsudo-no-yoru": { id: "ginga-tetsudo-no-yoru", title: "銀河鉄道の夜", author: "宮沢賢治", description: "ジョバンニとカムパネルラが銀河を走る列車で旅をし、幸福と別れを見つめる童話。", card: "https://www.aozora.gr.jp/cards/000081/card456.html", source: "https://www.aozora.gr.jp/cards/000081/files/456_15050.html", baseEdition: "新編　銀河鉄道の夜", publisher: "新潮文庫、新潮社", sourceEditionDate: "1994-06-05（第13刷）", proofEditionDate: "同一底本", inputBy: "野口英司、中村隆生", proofreadBy: "野口英司" },
  "hashire-melos": { id: "hashire-melos", title: "走れメロス", author: "太宰治", description: "友との約束を守るため、処刑の時刻へ向かって走るメロスの信頼と葛藤を描く短編小説。", card: "https://www.aozora.gr.jp/cards/000035/card1567.html", source: "https://www.aozora.gr.jp/cards/000035/files/1567_14913.html", baseEdition: "太宰治全集3", publisher: "ちくま文庫、筑摩書房", sourceEditionDate: "1988-10-25（初版）", proofEditionDate: "1998-06-15（第2刷）", inputBy: "金川一之", proofreadBy: "高橋美奈子" },
  rashomon: { id: "rashomon", title: "羅生門", author: "芥川竜之介", description: "荒廃した羅生門を舞台に、生きるための善悪が反転する瞬間を描く短編小説。", card: "https://www.aozora.gr.jp/cards/000879/card127.html", source: "https://www.aozora.gr.jp/cards/000879/files/127_15260.html", baseEdition: "芥川龍之介全集1", publisher: "ちくま文庫、筑摩書房", sourceEditionDate: "1997-04-15（第14刷）", proofEditionDate: "同一底本", inputBy: "野口英司、平山誠", proofreadBy: "もりみつじゅんじ", reportingNotice: "本文には今日からみて不適切と受け取られる可能性のある表現があります。青空文庫の方針に従い原文のまま掲載しています。本文の誤りや底本との差異は、青空文庫の作品カードに記載された窓口をご確認ください。" }
};

const cleanText = (value: string) => value.replace(/[\t\r\n]+/g, "").replace(/\u00a0/g, " ").trim();

export function parseAozoraXhtml(xhtml: string, fallbackTitle = "本文"): Chapter[] {
  const $ = cheerio.load(xhtml);
  $(".main_text rt, .main_text rp").remove();
  $(".main_text ruby, .main_text rb").each((_, node) => {
    $(node).replaceWith($(node).text());
  });
  const chapters: Chapter[] = [];
  let chapter: Chapter | undefined;
  let section: Section | undefined;
  let paragraph = "";
  const flush = () => {
    const text = cleanText(paragraph);
    paragraph = "";
    if (text && section) section.paragraphs.push(text);
  };
  const ensureChapter = () => {
    if (!chapter) {
      chapter = { slug: `part-${chapters.length + 1}`, title: fallbackTitle, lead: `${fallbackTitle}を読む`, sections: [] };
      chapters.push(chapter);
    }
    return chapter;
  };
  const ensureSection = () => {
    const currentChapter = ensureChapter();
    if (!section) {
      section = { id: `section-${currentChapter.sections.length + 1}`, heading: "本文", paragraphs: [] };
      currentChapter.sections.push(section);
    }
    return section;
  };
  $(".main_text").contents().each((_, node) => {
    const element = $(node);
    const major = element.find("h3.o-midashi").first();
    const minor = element.find("h4.naka-midashi").first();
    if (major.length) {
      flush();
      const title = cleanText(major.text());
      chapter = { slug: `part-${chapters.length + 1}`, title, lead: `${title}を読む`, sections: [] };
      chapters.push(chapter);
      section = undefined;
    } else if (minor.length) {
      flush();
      const currentChapter = ensureChapter();
      section = { id: `section-${currentChapter.sections.length + 1}`, heading: cleanText(minor.text()), paragraphs: [] };
      currentChapter.sections.push(section);
    } else if (node.type === "tag" && node.name === "br") {
      ensureSection();
      flush();
    } else {
      ensureSection();
      paragraph += element.text();
    }
  });
  flush();
  for (const item of chapters) item.sections = item.sections.filter((candidate) => candidate.paragraphs.length > 0);
  chapters.splice(0, chapters.length, ...chapters.filter((item) => item.sections.length > 0));
  if (!chapters.length || chapters.some((item) => !item.sections.length)) throw new Error("Unexpected Aozora XHTML structure");
  return chapters;
}

async function importPreset(preset: BookPreset, localPath?: string) {
  const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const bytes = localPath ? await readFile(resolve(localPath)) : new Uint8Array(await (await fetch(preset.source)).arrayBuffer());
  const chapters = parseAozoraXhtml(new TextDecoder("shift_jis").decode(bytes), preset.title);
  const output = {
    id: preset.id, title: preset.title, author: preset.author, description: preset.description,
    ...(preset.id === "kokoro" ? { coverImageUrl: "/images/books/kokoro-cover.webp" } : {}),
    language: "ja", licenseName: "著作権保護期間満了（パブリックドメイン）", licenseUrl: preset.card,
    sourceSiteName: "青空文庫", sourceSiteUrl: preset.card,
    reportingNotice: preset.reportingNotice ?? "本文の誤りや底本との差異は、青空文庫の作品カードに記載された窓口をご確認ください。",
    distributionNotice: "青空文庫の公開ファイルを横書きの記事形式へ変換しています。", readingMode: "article",
    provenance: { workCardUrl: preset.card, sourceFileUrl: preset.source, baseEdition: preset.baseEdition, publisher: preset.publisher, sourceEditionDate: preset.sourceEditionDate, proofEditionDate: preset.proofEditionDate, inputBy: preset.inputBy, proofreadBy: preset.proofreadBy, importedAt: "2026-08-12" },
    chapters,
  };
  await writeFile(resolve(appRoot, `content/books/${preset.id}.json`), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Imported ${output.title}: ${chapters.length} parts, ${chapters.reduce((sum, part) => sum + part.sections.length, 0)} sections`);
}

async function main() {
  const requested = process.argv.slice(2);
  if (requested[0] && !PRESETS[requested[0]]) {
    await importPreset(PRESETS.kokoro, requested[0]);
    return;
  }
  const ids = requested.length ? requested : ["kokoro"];
  for (const id of ids) {
    const preset = PRESETS[id];
    if (!preset) throw new Error(`Unknown book preset: ${id}`);
    await importPreset(preset);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
