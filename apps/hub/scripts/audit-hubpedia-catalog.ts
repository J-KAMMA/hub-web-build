import { auditCatalog } from "../lib/encyclopedia/catalog-audit";
import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed";

const report = auditCatalog(VIEWABLE_SEED_ARTICLES);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--strict") && (
  report.brokenInternalLinks.length > 0
  || report.duplicateTitles.length > 0
  || report.unapprovedDisplayedSources.length > 0
)) process.exitCode = 1;
if (process.argv.includes("--publication-strict") && report.publicationBlockerCount > 0) process.exitCode = 1;
