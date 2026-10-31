import { NextResponse } from "next/server";
import { apiError, requireAdmin } from "@/lib/encyclopedia/admin";
import { auditCatalog } from "@/lib/encyclopedia/catalog-audit";
import { getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const report = auditCatalog(await getPublicReaderReadySeedArticles());
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      articleCount: report.articleCount,
      publicationBlockerCount: report.publicationBlockerCount,
      lowQualityArticles: report.lowQualityArticles,
      quality: report.qualityAssessments.map(({ slug, locale, assessment }) => ({
        slug,
        locale,
        score: assessment.score,
        publishable: assessment.publishable,
        evidenceCoverage: assessment.evidenceCoverage,
        structureIssues: assessment.structureIssues,
        duplicatePassages: assessment.duplicatePassages,
        linkIssues: assessment.linkIssues,
      })),
      maintenance: report.maintenance,
    });
  } catch (error) {
    return apiError(error);
  }
}
