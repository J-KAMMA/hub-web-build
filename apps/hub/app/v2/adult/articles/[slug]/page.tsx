import type { Metadata } from "next";

import { adultArticleMetadata, AdultArticleScreen } from "@/components/adult/adult-article-screen";

import "../../../../adult/adult.css";
import "../../../../articles/reader.css";
import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = adultArticleMetadata;

export default async function V2AdultArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  return <AdultArticleScreen params={params} surface="/v2" />;
}
