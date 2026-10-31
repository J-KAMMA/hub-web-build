export const HUBPEDIA_PUBLICATION_POLICY_VERSION = "article-authoring-v1.1.0";

// 2026-08-28: the legacy corpus was removed by explicit owner decision, so
// approval now covers only factory-rebuilt articles. 2026-09-18: the owner
// approved the first publication wave — the 120 audited, quote-verified
// records from batches w1-w4 — for the public catalog and the AI knowledge
// layer. A slug belongs here only after a factory-rebuilt article passes the
// current publication policy and human review.
export const HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS = [
  // w1
  "earth", "el-nino", "exoplanet", "galaxy", "glacier", "hurricane", "landslide", "lightning", "mercury", "milky-way", "nebula", "neptune", "plate-tectonics", "pluto", "saturn", "supernova", "thunderstorm", "tornado", "tsunami", "volcano",
  // w2
  "apollo-program", "cloning", "consumer-price-index", "coral-reef", "crispr", "deep-ocean", "drought", "federal-reserve", "flood", "genetic-variation", "groundwater", "hubble-space-telescope", "inflation", "interest-rate", "iss", "james-webb-space-telescope", "marine-heatwave", "ocean-current", "permafrost", "pharmacogenomics", "soil", "stem-cell", "tide", "unemployment", "voyager",
  // w3
  "artemis-program", "blizzard", "carrier-screening", "cassini", "discount-window", "epigenetics", "federal-funds-rate", "fog", "galileo-spacecraft", "gene-therapy", "genetic-testing", "genome-sequencing", "geyser", "hail", "heat-wave", "mars-rover", "mineral", "open-market-operations", "quantitative-easing", "reserve-requirements", "rock-cycle", "sediment", "sinkhole", "space-shuttle", "wind-chill",
  // w4
  "ancestry", "antibiotic-resistance", "asteroid", "atomic-clock", "bank-supervision", "carbon-cycle", "central-bank", "clinical-trial", "cryptography", "currency", "cybersecurity-framework", "declaration-of-independence", "emancipation-proclamation", "extreme-poverty", "fomc", "food-security", "gettysburg-address", "glacier-national-park", "grand-canyon", "great-smoky-mountains", "groundwater-depletion", "immune-system", "kuiper-belt", "literacy", "louisiana-purchase", "maternal-mortality", "meteor-shower", "near-earth-object", "oort-cloud", "ozone-layer", "payment-systems", "pedigree", "polygenic-risk-score", "precision-medicine", "quantum-computing", "rare-disease", "sea-level-rise", "si-units", "snowpack", "snp", "streamflow", "urban-heat-island", "us-constitution", "vaccination-coverage", "vaccine", "water-quality", "watershed", "wildfire", "yellowstone", "yosemite",
] as const;

const approvedSeedArticleSlugs = new Set<string>(HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS);

export function isApprovedSeedArticleSlug(slug: string) {
  return approvedSeedArticleSlugs.has(slug);
}
