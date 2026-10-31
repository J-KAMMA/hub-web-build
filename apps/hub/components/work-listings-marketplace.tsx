"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type WorkApplicationStatus,
  type WorkInquiry,
  type WorkListing,
  type WorkListingKind,
  type WorkStyle,
} from "@/lib/work-listings";
import {
  WORK_CATEGORY_TAXONOMY,
  workCategoryLabel,
  workCategoryMatches,
  workTagSuggestions,
  type WorkMarketplaceMode,
} from "@/lib/work-category-taxonomy";
import { HUB_MARKETPLACE_FEE_PERCENT } from "@/lib/commercial-pricing-policy";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import {
  emptyJobDraft,
  employmentLabels,
  jobDetails,
  JobCardFacts,
  JobFields,
  periodLabels,
  salaryLabel,
  type EmploymentType,
  type JobDraft,
  type JobDetails,
  type JobListing,
  type SalaryPeriod,
} from "./job-listing-ui";
import styles from "./work-listings-marketplace.module.css";
import { WorkCategoryPicker } from "./work-category-picker";
import { parseContentTagInput } from "@/lib/content-tags";
import { V2TagInput } from "./v2/v2-tag-input";
import { WorkEscrowPanel } from "./work-escrow-panel";

type View = "discover" | "saved" | "manage" | "messages";
type Scope = "received" | "sent";
type Message = {
  id: string;
  senderProfileId?: string;
  senderName?: string;
  body: string;
  createdAt: string;
  sentByViewer?: boolean;
};
type Thread = WorkInquiry & {
  status?: WorkApplicationStatus;
  unread?: boolean;
  messages?: Message[];
  ownerName?: string;
  ownerHandle?: string;
};
type SavedSearch = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  notificationEnabled: boolean;
  matchCount?: number;
};
type Analytics = {
  views: number;
  inquiries: number;
  saves: number;
  days?: Array<{
    day: string;
    views: number;
    inquiries: number;
    saves: number;
  }>;
};
type Dialog =
  | { type: "detail"; listing: WorkListing }
  | { type: "form"; listing?: WorkListing }
  | { type: "inquiry" | "report"; listing: WorkListing }
  | null;
type Draft = {
  kind: WorkListingKind;
  category: string;
  title: string;
  summary: string;
  skills: string;
  workStyle: WorkStyle;
  engagement: string;
  location: string;
  workload: string;
  compensationLabel: string;
  budgetAmount: string;
  deadline: string;
};
type PendingJobDetails = {
  listing: WorkListing;
  details: JobDetails;
};
type StoredListingDraft = {
  version: 2;
  draft: Draft;
  jobDraft?: JobDraft;
  pendingJobDetails?: PendingJobDetails;
};
type DraftStorageState = "idle" | "saving" | "saved" | "unavailable";
type ListingSaveState =
  | { status: "idle" }
  | { status: "saving-listing" }
  | { status: "saving-job-details"; pending: PendingJobDetails }
  | { status: "failed"; error: string }
  | {
      status: "partially-succeeded";
      pending: PendingJobDetails;
      error?: string;
    };
const CROWDSOURCING_DRAFT_KEY = "hub.crowdsourcing-listing-draft.v1";
const JOB_DRAFT_KEY = "hub.job-listing-draft.v1";
const kinds: Record<WorkListingKind, string> = {
  service: "スキル出品",
  request: "依頼",
  job: "求人",
};
const stylesLabel: Record<WorkStyle, string> = {
  remote: "リモート",
  hybrid: "ハイブリッド",
  onsite: "現地",
};
const statuses: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  paused: "停止中",
  rejected: "非承認",
  new: "未確認",
  reviewing: "検討中",
  accepted: "成立",
  declined: "辞退",
  withdrawn: "取り下げ",
};
const emptyDraft: Draft = {
  kind: "request",
  category: "development",
  title: "",
  summary: "",
  skills: "",
  workStyle: "remote",
  engagement: "one_off",
  location: "",
  workload: "",
  compensationLabel: "",
  budgetAmount: "",
  deadline: "",
};
function isKnownCategory(mode: WorkMarketplaceMode, category: string) {
  return (
    category === "all" ||
    WORK_CATEGORY_TAXONOMY[mode].some(
      (parent) =>
        parent.id === category ||
        parent.children.some((child) => child.id === category),
    )
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hasOwn(source: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(source, key);
}
function storedString(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
  maxLength: number,
) {
  const value = source[key];
  return typeof value === "string" && value.length <= maxLength
    ? value
    : fallback;
}
function storedIntegerString(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
  minimum = 0,
) {
  const value = storedString(source, key, fallback, 40);
  if (value === "") return value;
  if (!/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? value : fallback;
}
function sanitizeStoredDraft(
  value: unknown,
  initial: Draft,
  allowedKinds: WorkListingKind[],
  mode: WorkMarketplaceMode,
): Draft {
  if (!isRecord(value)) return initial;
  const kind = allowedKinds.includes(value.kind as WorkListingKind)
    ? (value.kind as WorkListingKind)
    : initial.kind;
  const categoryCandidate = storedString(
    value,
    "category",
    initial.category,
    100,
  );
  const category =
    categoryCandidate !== "all" && isKnownCategory(mode, categoryCandidate)
      ? categoryCandidate
      : initial.category;
  const workStyle = hasOwn(stylesLabel, value.workStyle as PropertyKey)
    ? (value.workStyle as WorkStyle)
    : initial.workStyle;
  return {
    kind,
    category,
    title: storedString(value, "title", initial.title, 120),
    summary: storedString(value, "summary", initial.summary, 3000),
    skills: storedString(value, "skills", initial.skills, 2000),
    workStyle,
    engagement: storedString(value, "engagement", initial.engagement, 100),
    location: storedString(value, "location", initial.location, 300),
    workload: storedString(value, "workload", initial.workload, 300),
    compensationLabel: storedString(
      value,
      "compensationLabel",
      initial.compensationLabel,
      300,
    ),
    budgetAmount: storedIntegerString(
      value,
      "budgetAmount",
      initial.budgetAmount,
      1,
    ),
    deadline: (() => {
      const deadline = storedString(value, "deadline", initial.deadline, 10);
      return deadline === "" || /^\d{4}-\d{2}-\d{2}$/.test(deadline)
        ? deadline
        : initial.deadline;
    })(),
  };
}
function sanitizeStoredJobDraft(value: unknown): JobDraft {
  if (!isRecord(value)) return emptyJobDraft;
  const employmentType = hasOwn(
    employmentLabels,
    value.employmentType as PropertyKey,
  )
    ? (value.employmentType as EmploymentType)
    : emptyJobDraft.employmentType;
  const salaryPeriod = hasOwn(
    periodLabels,
    value.salaryPeriod as PropertyKey,
  )
    ? (value.salaryPeriod as SalaryPeriod)
    : emptyJobDraft.salaryPeriod;
  return {
    employmentType,
    occupation: storedString(value, "occupation", "", 200),
    salaryMin: storedIntegerString(value, "salaryMin", ""),
    salaryMax: storedIntegerString(value, "salaryMax", ""),
    salaryPeriod,
    hours: storedString(value, "hours", "", 300),
    holidays: storedString(value, "holidays", "", 300),
    probation: storedString(value, "probation", "", 300),
    location: storedString(value, "location", "", 300),
    transfer: storedString(value, "transfer", "", 300),
    remote: storedString(value, "remote", emptyJobDraft.remote, 300),
    benefits: storedString(value, "benefits", "", 1000),
    contractPeriod: storedString(value, "contractPeriod", "", 300),
    dutiesChangeScope: storedString(value, "dutiesChangeScope", "", 1000),
    locationChangeScope: storedString(value, "locationChangeScope", "", 1000),
    renewalCriteria: storedString(value, "renewalCriteria", "", 1000),
    openings: storedIntegerString(
      value,
      "openings",
      emptyJobDraft.openings,
      1,
    ),
    companyName: storedString(value, "companyName", "", 300),
    business: storedString(value, "business", "", 2000),
    companySize: storedString(value, "companySize", "", 300),
    companySite: storedString(value, "companySite", "", 2000),
    recruiterLabel: storedString(value, "recruiterLabel", "", 300),
  };
}
function jobDraftFromDetails(job: JobDetails): JobDraft {
  return {
    employmentType: job.employmentType,
    occupation: job.occupation,
    salaryMin: String(job.salaryMin ?? ""),
    salaryMax: String(job.salaryMax ?? ""),
    salaryPeriod: job.salaryPeriod ?? "monthly",
    hours: job.hours,
    holidays: job.holidays,
    probation: job.probation,
    location: job.location,
    transfer: job.transfer,
    remote: job.remote,
    benefits: job.benefits,
    contractPeriod: job.contractPeriod,
    dutiesChangeScope: job.dutiesChangeScope ?? "",
    locationChangeScope: job.locationChangeScope ?? "",
    renewalCriteria: job.renewalCriteria ?? "",
    openings: String(job.openings),
    companyName: job.companyName,
    business: job.business,
    companySize: job.companySize,
    companySite: job.companySite,
    recruiterLabel: job.recruiterLabel,
  };
}
function jobDetailsFromDraft(jobDraft: JobDraft): JobDetails {
  return {
    ...jobDraft,
    salaryMin: jobDraft.salaryMin ? Number(jobDraft.salaryMin) : null,
    salaryMax: jobDraft.salaryMax ? Number(jobDraft.salaryMax) : null,
    openings: Number(jobDraft.openings),
    verification: "self_reported",
    jobReviewStatus: "pending",
  };
}
function isStoredJobListing(value: unknown): value is WorkListing {
  if (!value || typeof value !== "object") return false;
  const listing = value as Partial<WorkListing>;
  const stringFields = [
    listing.ownerProfileId,
    listing.ownerName,
    listing.ownerHandle,
    listing.title,
    listing.summary,
    listing.category,
    listing.location,
    listing.compensationLabel,
    listing.engagement,
    listing.workload,
    listing.createdAt,
    listing.updatedAt,
  ];
  return (
    typeof listing.id === "string" &&
    /^[a-zA-Z0-9_-]+$/.test(listing.id) &&
    listing.id.length <= 200 &&
    listing.kind === "job" &&
    stringFields.every((field) => typeof field === "string") &&
    listing.title!.length <= 120 &&
    listing.summary!.length <= 3000 &&
    Array.isArray(listing.skills) &&
    listing.skills.length <= 50 &&
    listing.skills.every(
      (skill) => typeof skill === "string" && skill.length <= 100,
    ) &&
    hasOwn(stylesLabel, listing.workStyle as PropertyKey) &&
    ["draft", "published", "paused", "rejected"].includes(
      String(listing.status),
    ) &&
    typeof listing.ownedByViewer === "boolean" &&
    (listing.budgetAmount === null ||
      (typeof listing.budgetAmount === "number" &&
        Number.isSafeInteger(listing.budgetAmount) &&
        listing.budgetAmount >= 1)) &&
    (listing.deadline === null || typeof listing.deadline === "string") &&
    (listing.publishedAt === null ||
      typeof listing.publishedAt === "string")
  );
}
function date(v?: string | null) {
  return v
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(v))
    : "指定なし";
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (data as { error?: string }).error ||
        "操作を完了できませんでした。時間をおいて再度お試しください。",
    );
  return data as T;
}

function DialogBox({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !ref.current) return;
      const xs = [
        ...ref.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ),
      ];
      if (!xs.length) return;
      if (e.shiftKey && document.activeElement === xs[0]) {
        e.preventDefault();
        xs.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === xs.at(-1)) {
        e.preventDefault();
        xs[0].focus();
      }
    };
    document.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLElement>("button,input")?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {children}
      </div>
    </div>
  );
}

function ListingCard({
  listing,
  onOpen,
  onSave,
}: {
  listing: WorkListing;
  onOpen: () => void;
  onSave: (x: WorkListing) => void;
}) {
  /* 見ている面の中に留まる。v2 から見ているなら /v2/profile/… へ。 */
  const surface = useHubUiSurface();
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.kind}>{kinds[listing.kind]}</span>
        <button
          className={styles.save}
          type="button"
          aria-pressed={!!listing.savedByViewer}
          aria-label={listing.savedByViewer ? "保存を解除" : "掲載を保存"}
          onClick={() => onSave(listing)}
        >
          {listing.savedByViewer ? "★ 保存済み" : "☆ 保存"}
        </button>
      </div>
      <button className={styles.cardTitle} onClick={onOpen}>
        <h2>{listing.title}</h2>
      </button>
      <a
        className={styles.owner}
        href={hubSurfacePath(surface, `/profile/${encodeURIComponent(listing.ownerHandle)}`)}
      >
        {listing.ownerName} <span>@{listing.ownerHandle}</span>
      </a>
      <p className={styles.summary}>{listing.summary}</p>
      <div className={styles.tags}>
        <span>
          {workCategoryLabel(
            listing.kind === "job" ? "jobs" : "crowdsourcing",
            listing.category,
          )}
        </span>
        <span>{stylesLabel[listing.workStyle]}</span>
        {listing.skills.slice(0, 3).map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      {listing.kind === "job" ? (
        <JobCardFacts listing={listing as JobListing} />
      ) : (
        <dl className={styles.facts}>
          <div>
            <dt>報酬・予算</dt>
            <dd>{listing.compensationLabel}</dd>
          </div>
          <div>
            <dt>期限</dt>
            <dd>{date(listing.deadline)}</dd>
          </div>
        </dl>
      )}
      <footer>
        <small>{date(listing.publishedAt || listing.updatedAt)} 更新</small>
        <button onClick={onOpen}>詳細を見る</button>
      </footer>
    </article>
  );
}

function DiscoveryIntro({
  mode,
  listingCount,
  onSelectKind,
  onCreate,
}: {
  mode: "crowdsourcing" | "jobs";
  listingCount: number;
  onSelectKind: (kind: WorkListingKind) => void;
  onCreate: () => void;
}) {
  if (mode === "jobs") {
    return (
      <section className={styles.discoveryIntro} aria-label="求人の使い方">
        <article>
          <small>求人を探す</small>
          <strong>{listingCount}件の公開求人</strong>
          <p>職種、給与、雇用形態、勤務地を比較して応募先を選べます。</p>
          <button type="button" onClick={() => onSelectKind("job")}>求人一覧を見る</button>
        </article>
        <article>
          <small>外部サイトで応募</small>
          <strong>応募は掲載企業へ直接送信</strong>
          <p>Hubは応募情報を受け取らず、掲載企業の公式応募先へ案内します。</p>
          <button type="button" onClick={() => onSelectKind("job")}>
            応募先のある求人を見る
          </button>
        </article>
        <article>
          <small>採用する</small>
          <strong>雇用条件を明確に掲載</strong>
          <p>給与、勤務時間、勤務地、契約条件を入力して求人を公開します。</p>
          <button type="button" onClick={onCreate}>求人を掲載</button>
        </article>
      </section>
    );
  }
  return (
    <section className={styles.discoveryIntro} aria-label="依頼・スキルの使い方">
      <article>
        <small>仕事を頼む</small>
        <strong>必要な成果物を依頼</strong>
        <p>予算、納期、必要スキルを明示して受注者を募集できます。</p>
        <button type="button" onClick={() => onSelectKind("request")}>依頼を探す</button>
      </article>
      <article>
        <small>仕事を受ける</small>
        <strong>得意なスキルを出品</strong>
        <p>提供内容、納期、料金の目安を掲載して相談を受けられます。</p>
        <button type="button" onClick={() => onSelectKind("service")}>スキル出品を見る</button>
      </article>
      <article>
        <small>取引を始める</small>
        <strong>依頼と相談を分けて管理</strong>
        <p>掲載内容を確認してからメッセージで条件をすり合わせます。</p>
        <button type="button" onClick={onCreate}>依頼・出品を作成</button>
      </article>
    </section>
  );
}

function ListingForm({
  listing,
  allowedKinds,
  mode,
  draftKey,
  onClose,
  onSaved,
}: {
  listing?: WorkListing;
  allowedKinds: WorkListingKind[];
  mode: WorkMarketplaceMode;
  draftKey: string;
  onClose: () => void;
  onSaved: (x: WorkListing) => void;
}) {
  const initial = useMemo<Draft>(
    () =>
      listing
        ? {
            kind: listing.kind,
            category: listing.category,
            title: listing.title,
            summary: listing.summary,
            skills: listing.skills.join(", "),
            workStyle: listing.workStyle,
            engagement: listing.engagement,
            location: listing.location,
            workload: listing.workload,
            compensationLabel: listing.compensationLabel,
            budgetAmount: String(listing.budgetAmount ?? ""),
            deadline: listing.deadline?.slice(0, 10) || "",
          }
        : {
            ...emptyDraft,
            kind: allowedKinds[0] ?? "request",
            category:
              WORK_CATEGORY_TAXONOMY[mode][0]?.children[0]?.id ??
              WORK_CATEGORY_TAXONOMY[mode][0]?.id ??
              "other",
          },
    [allowedKinds, listing, mode],
  );
  const existingJob = listing ? jobDetails(listing as JobListing) : undefined;
  const [draft, setDraft] = useState(initial),
    [jobDraft, setJobDraft] = useState<JobDraft>(
      existingJob ? jobDraftFromDetails(existingJob) : emptyJobDraft,
    ),
    [preview, setPreview] = useState(false),
    [saveState, setSaveState] = useState<ListingSaveState>({
      status: "idle",
    }),
    [storageReady, setStorageReady] = useState(Boolean(listing)),
    [draftDirty, setDraftDirty] = useState(false),
    [restored, setRestored] = useState(false),
    [draftStorageState, setDraftStorageState] =
      useState<DraftStorageState>("idle");
  const submissionInFlight = useRef(false);
  const busy =
    saveState.status === "saving-listing" ||
    saveState.status === "saving-job-details";
  const pendingJobDetails =
    saveState.status === "saving-job-details" ||
    saveState.status === "partially-succeeded"
      ? saveState.pending
      : null;
  const error =
    saveState.status === "failed" ||
    saveState.status === "partially-succeeded"
      ? saveState.error
      : undefined;
  const baseListingSaved = Boolean(pendingJobDetails);
  const saveDraft = useCallback(
    (pending: PendingJobDetails | null) => {
      if (listing) return;
      try {
        const value: StoredListingDraft = {
          version: 2,
          draft,
          ...(draft.kind === "job" ? { jobDraft } : {}),
          ...(pending ? { pendingJobDetails: pending } : {}),
        };
        localStorage.setItem(draftKey, JSON.stringify(value));
        setDraftStorageState("saved");
      } catch {
        setDraftStorageState("unavailable");
      }
    },
    [draft, draftKey, jobDraft, listing],
  );
  useEffect(() => {
    if (!listing || listing.kind !== "job" || existingJob) return;
    void json<{ job: JobDetails }>(`/api/work-listings/jobs/${listing.id}`)
      .then(({ job }) => setJobDraft(jobDraftFromDetails(job)))
      .catch((e) =>
        setSaveState({
          status: "failed",
          error:
            e instanceof Error ? e.message : "求人条件を取得できませんでした",
        }),
      );
  }, [listing, existingJob]);
  useEffect(() => {
    if (listing) return;
    try {
      const serialized = localStorage.getItem(draftKey);
      if (!serialized) return;
      const restoredValue = JSON.parse(serialized) as unknown;
      const version =
        isRecord(restoredValue) && typeof restoredValue.version === "number"
          ? restoredValue.version
          : null;
      const saved =
        version !== null &&
        version <= 2 &&
        isRecord(restoredValue) &&
        isRecord(restoredValue.draft)
          ? restoredValue
          : null;
      if (version !== null && !saved) return;
      const restoredDraft = sanitizeStoredDraft(
        saved?.draft ?? restoredValue,
        initial,
        allowedKinds,
        mode,
      );
      const restoredJobDraft = sanitizeStoredJobDraft(saved?.jobDraft);
      setDraft(restoredDraft);
      setJobDraft(restoredJobDraft);
      const pending = isRecord(saved?.pendingJobDetails)
        ? saved.pendingJobDetails
        : null;
      if (isStoredJobListing(pending?.listing)) {
        setSaveState({
          status: "partially-succeeded",
          pending: {
            listing: pending.listing,
            details: jobDetailsFromDraft(restoredJobDraft),
          },
        });
      }
      setDraftDirty(true);
      setRestored(true);
      setDraftStorageState("saved");
    } catch {
      // Keep an unreadable draft in storage so a transient client issue never
      // destroys the user's only copy.
      setDraftStorageState("unavailable");
    } finally {
      setStorageReady(true);
    }
  }, [draftKey, listing]);
  useEffect(() => {
    if (!storageReady || listing || (!draftDirty && !pendingJobDetails)) return;
    saveDraft(
      pendingJobDetails
        ? {
            listing: pendingJobDetails.listing,
            details: jobDetailsFromDraft(jobDraft),
          }
        : null,
    );
  }, [
    draft,
    draftDirty,
    jobDraft,
    listing,
    pendingJobDetails,
    saveDraft,
    storageReady,
  ]);
  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (busy || baseListingSaved) return;
    setDraftDirty(true);
    setRestored(false);
    setDraftStorageState("saving");
    setDraft((x) => ({ ...x, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setRestored(false);
    let activePending = pendingJobDetails
      ? {
          listing: pendingJobDetails.listing,
          details: jobDetailsFromDraft(jobDraft),
        }
      : null;
    try {
      let savedListing: WorkListing;
      let details: JobDetails | undefined;
      if (activePending) {
        savedListing = activePending.listing;
        details = activePending.details;
        setSaveState({
          status: "saving-job-details",
          pending: activePending,
        });
        saveDraft(activePending);
      } else {
        setSaveState({ status: "saving-listing" });
        const payload = {
          ...draft,
          budgetAmount: draft.budgetAmount || null,
          skills: draft.skills
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        };
        const out = await json<{ listing: WorkListing }>(
          listing ? `/api/work-listings/${listing.id}` : "/api/work-listings",
          {
            method: listing ? "PATCH" : "POST",
            body: JSON.stringify(
              listing ? { action: "edit", ...payload } : payload,
            ),
          },
        );
        savedListing = out.listing;
        if (draft.kind === "job") {
          details = jobDetailsFromDraft(jobDraft);
          activePending = { listing: savedListing, details };
          setSaveState({
            status: "saving-job-details",
            pending: activePending,
          });
          saveDraft(activePending);
        }
      }
      if (details) {
        await json(
          `/api/work-listings/jobs/${encodeURIComponent(savedListing.id)}`,
          {
          method: "PUT",
          body: JSON.stringify(details),
          },
        );
        savedListing = { ...savedListing, job: details } as JobListing;
      }
      if (!listing) {
        setDraftDirty(false);
        try {
          localStorage.removeItem(draftKey);
          setDraftStorageState("idle");
        } catch {
          setDraftStorageState("unavailable");
        }
      }
      setSaveState({ status: "idle" });
      onSaved(savedListing);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "保存できませんでした";
      if (activePending) {
        saveDraft(activePending);
        setSaveState({
          status: "partially-succeeded",
          pending: activePending,
          error: message,
        });
      } else {
        setSaveState({ status: "failed", error: message });
      }
    } finally {
      submissionInFlight.current = false;
    }
  }
  return (
    <form
      className={styles.form}
      onSubmit={submit}
      aria-busy={busy}
    >
      <header>
        <div>
          <small>{listing ? "掲載内容を更新" : "新しい掲載"}</small>
          <h2>{listing ? listing.title : "掲載の下書きを作成"}</h2>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      </header>
      {restored && !listing ? (
        <p className={styles.restore} role="status">
          保存途中の入力を復元しました。
        </p>
      ) : null}
      {!listing && draftDirty && draftStorageState === "saving" ? (
        <p className={styles.notice} role="status" aria-live="polite">
          下書きをこの端末に保存しています…
        </p>
      ) : !listing && draftDirty && draftStorageState === "saved" ? (
        <p className={styles.notice} role="status" aria-live="polite">
          下書きはこの端末に保存されています。
        </p>
      ) : null}
      {!listing && draftStorageState === "unavailable" ? (
        <p className={styles.error} role="alert">
          この端末に下書きを保存できません。画面を閉じる前に入力内容を確認してください。
        </p>
      ) : null}
      {saveState.status === "saving-listing" ? (
        <p className={styles.notice} role="status" aria-live="polite">
          基本掲載を保存しています…
        </p>
      ) : saveState.status === "saving-job-details" ? (
        <p className={styles.notice} role="status" aria-live="polite">
          基本掲載は保存済みです。求人詳細を保存しています…
        </p>
      ) : saveState.status === "partially-succeeded" ? (
        <p className={styles.notice} role="status">
          基本掲載は保存済みです。求人詳細だけを再試行できます。求人は重複作成されません。
        </p>
      ) : null}
      <div className={styles.formGrid}>
        <label>
          種類
          <select
            disabled={busy || baseListingSaved}
            value={draft.kind}
            onChange={(e) => field("kind", e.target.value as WorkListingKind)}
          >
            {Object.entries(kinds).filter(([v]) => allowedKinds.includes(v as WorkListingKind)).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          カテゴリ
          <select
            disabled={busy || baseListingSaved}
            value={draft.category}
            onChange={(e) => field("category", e.target.value)}
          >
            {WORK_CATEGORY_TAXONOMY[mode].map((parent) => (
              <optgroup key={parent.id} label={parent.label}>
                {parent.children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={styles.full}>
          タイトル
          <input
            disabled={busy || baseListingSaved}
            required
            minLength={5}
            maxLength={120}
            value={draft.title}
            onChange={(e) => field("title", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          詳細
          <textarea
            disabled={busy || baseListingSaved}
            required
            minLength={30}
            maxLength={3000}
            rows={7}
            value={draft.summary}
            onChange={(e) => field("summary", e.target.value)}
          />
        </label>
        <div
          className={styles.full}
          aria-disabled={busy || baseListingSaved}
          inert={busy || baseListingSaved ? true : undefined}
        >
          <V2TagInput
            label={mode === "jobs" ? "スキル・特徴タグ" : "スキル・案件タグ"}
            value={parseContentTagInput(draft.skills)}
            onChange={(tags) => field("skills", tags.join(", "))}
            suggestions={workTagSuggestions(mode, draft.category)}
          />
        </div>
        <label>
          働き方
          <select
            disabled={busy || baseListingSaved}
            value={draft.workStyle}
            onChange={(e) => field("workStyle", e.target.value as WorkStyle)}
          >
            {Object.entries(stylesLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          契約形態
          <input
            disabled={busy || baseListingSaved}
            value={draft.engagement}
            onChange={(e) => field("engagement", e.target.value)}
          />
        </label>
        <label>
          場所
          <input
            disabled={busy || baseListingSaved}
            value={draft.location}
            onChange={(e) => field("location", e.target.value)}
          />
        </label>
        <label>
          稼働量
          <input
            disabled={busy || baseListingSaved}
            value={draft.workload}
            onChange={(e) => field("workload", e.target.value)}
          />
        </label>
        <label>
          報酬・予算
          <input
            disabled={busy || baseListingSaved}
            required
            value={draft.compensationLabel}
            onChange={(e) => field("compensationLabel", e.target.value)}
          />
        </label>
        <label>
          数値予算
          <input
            disabled={busy || baseListingSaved}
            type="number"
            min="1"
            value={draft.budgetAmount}
            onChange={(e) => field("budgetAmount", e.target.value)}
          />
        </label>
        <label>
          募集期限
          <input
            disabled={busy || baseListingSaved}
            type="date"
            value={draft.deadline}
            onChange={(e) => field("deadline", e.target.value)}
          />
        </label>
      </div>
      {draft.kind === "job" ? (
        <div aria-disabled={busy} inert={busy ? true : undefined}>
          <JobFields
            value={jobDraft}
            onChange={(value) => {
              if (busy) return;
              setDraftDirty(true);
              setRestored(false);
              setDraftStorageState("saving");
              setJobDraft(value);
            }}
            onTemplate={(template) => {
              if (busy || baseListingSaved) return;
              setDraftDirty(true);
              setRestored(false);
              setDraftStorageState("saving");
              setDraft((x) => ({ ...x, ...template }));
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setPreview((x) => !x)}
        aria-expanded={preview}
      >
        {preview ? "プレビューを閉じる" : "表示をプレビュー"}
      </button>
      {preview ? (
        <section className={styles.preview} aria-label="掲載プレビュー">
          <small>
            {kinds[draft.kind]}・{workCategoryLabel(mode, draft.category)}
          </small>
          <h3>{draft.title || "タイトル未入力"}</h3>
          <p>{draft.summary || "詳細を入力すると、ここに表示されます。"}</p>
          <strong>{draft.compensationLabel || "報酬未入力"}</strong>
        </section>
      ) : null}
      <aside className={styles.safety}>
        <strong>安全な取引のために</strong>
        <p>
          契約内容、成果物、報酬、期限を事前に確認してください。認証情報や送金を急かす依頼には応じないでください。
        </p>
      </aside>
      {error ? (
        <p className={styles.error} role="alert">
          {saveState.status === "partially-succeeded"
            ? "求人詳細を保存できませんでした。"
            : "掲載を保存できませんでした。"}
          入力内容は保持されています。{error}
        </p>
      ) : null}
      <footer>
        <button type="button" onClick={onClose} disabled={busy}>
          キャンセル
        </button>
        <button className={styles.primary} type="submit" disabled={busy}>
          {saveState.status === "saving-listing"
            ? "基本掲載を保存中…"
            : saveState.status === "saving-job-details"
              ? "求人詳細を保存中…"
              : saveState.status === "partially-succeeded"
                ? "求人詳細の保存を再試行"
                : saveState.status === "failed"
                  ? "保存を再試行"
                  : "下書きを保存"}
        </button>
      </footer>
    </form>
  );
}

export function WorkListingsMarketplace({
  mode = "crowdsourcing",
  initialCategory = "all",
  initialQuery = "",
  initialCreate = false,
}: {
  mode?: "crowdsourcing" | "jobs";
  initialCategory?: string;
  initialQuery?: string;
  initialCreate?: boolean;
}) {
  const allowedKinds: WorkListingKind[] =
    mode === "jobs" ? ["job"] : ["request", "service"];
  const [view, setView] = useState<View>("discover"),
    [listings, setListings] = useState<WorkListing[]>([]),
    [recommended, setRecommended] = useState<WorkListing[]>([]),
    [searches, setSearches] = useState<SavedSearch[]>([]),
    [threads, setThreads] = useState<Thread[]>([]),
    [threadError, setThreadError] = useState(""),
    [scope, setScope] = useState<Scope>("received"),
    [selected, setSelected] = useState<Thread | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [analytics, setAnalytics] = useState<Record<string, Analytics>>({});
  const [dialog, setDialog] = useState<Dialog>(
      initialCreate ? { type: "form" } : null,
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const initialListingRef = useRef<string | null>(null);
  const initialListingHandledRef = useRef(false);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [query, setQuery] = useState(initialQuery),
    [kind, setKind] = useState<WorkListingKind | "all">(
      mode === "jobs" ? "job" : "all",
    ),
    [workStyle, setWorkStyle] = useState<WorkStyle | "all">("all"),
    [category, setCategory] = useState(
      isKnownCategory(mode, initialCategory) ? initialCategory : "all",
    ),
    [employmentType, setEmploymentType] = useState<EmploymentType | "all">(
      "all",
    ),
    [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod | "all">("all"),
    [salaryMin, setSalaryMin] = useState(""),
    [remote, setRemote] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await json<{ listings: WorkListing[] }>(
        "/api/work-listings",
      );
      setListings(data.listings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const p = new URLSearchParams(location.search);
    const viewParam = p.get("view");
    const categoryParam = p.get("category") ?? initialCategory;
    initialListingRef.current = p.get("listing");
    if (viewParam && ["discover", "saved", "manage", "messages"].includes(viewParam))
      setView(viewParam as View);
    setQuery(p.get("q") ?? initialQuery);
    setCategory(
      categoryParam && isKnownCategory(mode, categoryParam)
        ? categoryParam
        : "all",
    );
    setUrlStateReady(true);
  }, [initialCategory, initialQuery, load, mode]);
  useEffect(() => {
    if (!urlStateReady) return;
    const params = new URLSearchParams();
    params.set("view", view);
    if (query.trim()) params.set("q", query.trim());
    if (category !== "all") params.set("category", category);
    if (!initialListingHandledRef.current && initialListingRef.current) {
      params.set("listing", initialListingRef.current);
    }
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }, [category, query, urlStateReady, view]);
  useEffect(() => {
    if (loading || initialListingHandledRef.current || !initialListingRef.current) return;
    initialListingHandledRef.current = true;
    const listing = listings.find((candidate) => candidate.id === initialListingRef.current);
    if (listing && allowedKinds.includes(listing.kind)) {
      setDialog({ type: "detail", listing });
    }
    const params = new URLSearchParams(location.search);
    params.delete("listing");
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }, [allowedKinds, listings, loading]);
  useEffect(() => {
    if (view === "saved")
      void Promise.all([
        json<{ searches?: SavedSearch[] }>("/api/work-listings/saved-searches")
          .then((x) => setSearches(x.searches || []))
          .catch((e) => setError(e.message)),
        json<{ listings: WorkListing[] }>("/api/work-listings/recommendations")
          .then((x) => setRecommended(x.listings || []))
          .catch(() => setRecommended([])),
      ]);
    if (view === "messages") void loadThreads(scope);
  }, [view, scope]);
  useEffect(() => {
    if (kind !== "job") return;
    const q = new URLSearchParams();
    if (employmentType !== "all") q.set("employmentType", employmentType);
    if (salaryPeriod !== "all") q.set("salaryPeriod", salaryPeriod);
    if (salaryMin) q.set("salaryMin", salaryMin);
    if (remote) q.set("remote", remote);
    void json<{ jobs: Array<JobDetails & { id: string }> }>(
      `/api/work-listings/jobs?${q}`,
    )
      .then(({ jobs }) =>
        setListings((items) =>
          items.map((item) => {
            const job = jobs.find((candidate) => candidate.id === item.id);
            return job ? ({ ...item, job } as JobListing) : item;
          }),
        ),
      )
      .catch((e) =>
        setNotice(
          e instanceof Error ? e.message : "求人を取得できませんでした",
        ),
      );
  }, [kind, employmentType, salaryPeriod, salaryMin, remote]);
  useEffect(() => {
    if (dialog?.type !== "detail" || dialog.listing.ownedByViewer) return;
    void json(`/api/work-listings/${dialog.listing.id}/view`, {
      method: "POST",
      body: JSON.stringify({ surface: "detail" }),
    }).catch(() => undefined);
  }, [dialog]);
  async function loadThreads(s: Scope) {
    setThreadError("");
    try {
      const x = await json<{ inquiries: Thread[] }>(
        `/api/work-listings/inquiries?scope=${s}`,
      );
      setThreads(x.inquiries || []);
    } catch (e) {
      setThreadError(
        e instanceof Error ? e.message : "メッセージを取得できませんでした",
      );
    }
  }
  const visible = useMemo(
    () =>
      listings
        .filter((x) => allowedKinds.includes(x.kind))
        .filter((x) =>
          view === "saved"
            ? x.savedByViewer
            : view === "manage"
              ? x.ownedByViewer
              : x.status === "published" && !x.ownedByViewer,
        )
        .filter((x) => kind === "all" || x.kind === kind)
        .filter((x) => workStyle === "all" || x.workStyle === workStyle)
        .filter((x) => workCategoryMatches(mode, x.category, category))
        .filter(
          (x) =>
            employmentType === "all" ||
            x.kind !== "job" ||
            jobDetails(x as JobListing)?.employmentType === employmentType,
        )
        .filter(
          (x) =>
            salaryPeriod === "all" ||
            x.kind !== "job" ||
            jobDetails(x as JobListing)?.salaryPeriod === salaryPeriod,
        )
        .filter(
          (x) =>
            !salaryMin ||
            x.kind !== "job" ||
            (jobDetails(x as JobListing)?.salaryMax ?? 0) >= Number(salaryMin),
        )
        .filter(
          (x) =>
            !remote ||
            x.kind !== "job" ||
            (jobDetails(x as JobListing)?.remote ?? "").includes(remote),
        )
        .filter((x) =>
          `${x.title} ${x.summary} ${x.skills.join(" ")}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        ),
    [
      listings,
      view,
      kind,
      workStyle,
      category,
      query,
      employmentType,
      salaryPeriod,
      salaryMin,
      remote,
      mode,
    ],
  );
  function replace(x: WorkListing) {
    setListings((xs) => xs.map((y) => (y.id === x.id ? x : y)));
  }
  async function save(x: WorkListing) {
    try {
      await json(`/api/work-listings/saves`, {
        method: "PUT",
        body: JSON.stringify({ listingId: x.id, saved: !x.savedByViewer }),
      });
      replace({ ...x, savedByViewer: !x.savedByViewer });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存できませんでした");
    }
  }
  async function listingAction(x: WorkListing, action: string, extra = {}) {
    try {
      const out = await json<{ listing: WorkListing }>(
        `/api/work-listings/${x.id}${action === "duplicate" ? "/duplicate" : action === "deadline" ? "/deadline" : ""}`,
        {
          method:
            action === "duplicate"
              ? "POST"
              : action === "deadline"
                ? "PUT"
                : "PATCH",
          body: JSON.stringify(
            action === "deadline" ? extra : { action, ...extra },
          ),
        },
      );
      if (action === "duplicate") setListings((xs) => [out.listing, ...xs]);
      else replace(out.listing);
      setDialog(null);
      setNotice(
        action === "duplicate"
          ? "掲載を複製しました。"
          : "掲載を更新しました。",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作できませんでした");
    }
  }
  async function openThread(t: Thread) {
    setSelected(t);
    try {
      const x = await json<{ messages: Message[] }>(
        `/api/work-listings/inquiries/${t.id}/messages`,
      );
      setMessages(x.messages || []);
      if (t.unread)
        await json(`/api/work-listings/inquiries/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "mark-read" }),
        });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "会話を取得できませんでした");
    }
  }
  async function sendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const f = new FormData(e.currentTarget),
      body = String(f.get("body") || "");
    try {
      const x = await json<{ message: Message }>(
        `/api/work-listings/inquiries/${selected.id}/messages`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      setMessages((xs) => [...xs, x.message]);
      e.currentTarget.reset();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "送信できませんでした");
    }
  }
  async function status(value: WorkApplicationStatus) {
    if (!selected) return;
    try {
      await json(`/api/work-listings/inquiries/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      setSelected({ ...selected, status: value });
      setThreads((xs) =>
        xs.map((x) => (x.id === selected.id ? { ...x, status: value } : x)),
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "状態を変更できませんでした");
    }
  }
  async function createSearch() {
    const name = prompt("保存する検索条件の名前");
    if (!name) return;
    try {
      const x = await json<{ search: SavedSearch }>(
        "/api/work-listings/saved-searches",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            filters: {
              query,
              kind: kind === "all" ? undefined : kind,
              workStyle: workStyle === "all" ? undefined : workStyle,
              category: category === "all" ? undefined : category,
            },
            notificationEnabled: true,
          }),
        },
      );
      setSearches((xs) => [x.search, ...xs]);
      setNotice("検索条件を保存しました。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存できませんでした");
    }
  }
  return (
    <section className={styles.market}>
      <header className={styles.hero}>
        <div>
          <h1>{mode === "jobs" ? "求人" : "依頼・スキル"}</h1>
          <p>{mode === "jobs" ? "雇用条件を確認して、自分に合う求人を探せます。" : "依頼を掲載するか、自分のスキルを出品できます。"}</p>
        </div>
        <button
          className={styles.primary}
          onClick={() => setDialog({ type: "form" })}
        >
          {mode === "jobs" ? "求人を掲載" : "依頼・出品を作成"}
        </button>
      </header>
      <section className={styles.commercialPolicy} aria-label="料金と取引範囲">
        {mode === "jobs" ? (
          <>
            <strong>求人掲載は無料</strong>
            <span>応募と雇用契約は掲載企業の外部サイトで行い、Hubは採用成功報酬を受け取りません。</span>
          </>
        ) : (
          <>
            <strong>掲載は無料・対象取引の販売手数料は本体価格の{HUB_MARKETPLACE_FEE_PERCENT}%（消費税込み）</strong>
            <span>雇用ではない業務成果物を対象に、Hub決済を使った場合だけ販売者受取額から差し引きます。</span>
          </>
        )}
      </section>
      <nav className={styles.views} aria-label={mode === "jobs" ? "求人" : "依頼・スキル"}>
        <button
          className={
            view === "discover" &&
            (mode === "jobs" ? kind === "job" : kind === "all")
              ? styles.active
              : ""
          }
          onClick={() => {
            setView("discover");
            setKind(mode === "jobs" ? "job" : "all");
          }}
        >
          {mode === "jobs" ? "求人を探す" : "すべて"}
        </button>
        {mode === "jobs" ? null : <button
          className={view === "discover" && kind === "request" ? styles.active : ""}
          onClick={() => {
            setView("discover");
            setKind("request");
          }}
        >
          依頼
        </button>}
        {mode === "jobs" ? null : <button
          className={view === "discover" && kind === "service" ? styles.active : ""}
          onClick={() => {
            setView("discover");
            setKind("service");
          }}
        >
          スキル出品
        </button>}
        <button
          className={view === "saved" ? styles.active : ""}
          onClick={() => setView("saved")}
        >
          保存
        </button>
        <button
          className={view === "manage" ? styles.active : ""}
          onClick={() => setView("manage")}
        >
          掲載管理
        </button>
        <button
          className={view === "messages" ? styles.active : ""}
          onClick={() => setView("messages")}
        >
          メッセージ
        </button>
      </nav>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="閉じる">
            ×
          </button>
        </p>
      ) : null}
      {view !== "messages" ? (
        <>
          {view === "discover" ? (
            <DiscoveryIntro
              mode={mode}
              listingCount={listings.filter((listing) =>
                allowedKinds.includes(listing.kind) &&
                listing.status === "published"
              ).length}
              onSelectKind={(nextKind) => {
                setKind(nextKind);
                requestAnimationFrame(() =>
                  document.getElementById("work-listing-results")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
              onCreate={() => setDialog({ type: "form" })}
            />
          ) : null}
          {view === "discover" || view === "saved" ? (
            <WorkCategoryPicker
              mode={mode}
              value={category}
              onChange={setCategory}
            />
          ) : null}
          <section className={styles.filters}>
            <label className={styles.search}>
              {mode === "jobs" ? "求人を検索" : "依頼・スキルを検索"}
              <input
                type="search"
                value={query}
                placeholder={
                  mode === "jobs"
                    ? "職種、会社、スキル"
                    : "依頼内容、提供スキル"
                }
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {mode === "crowdsourcing" ? <label>
              種類
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="all">すべて</option>
                {Object.entries(kinds).filter(([v]) => allowedKinds.includes(v as WorkListingKind)).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label> : null}
            <label>
              {mode === "jobs" ? "勤務形態" : "対応方法"}
              <select
                value={workStyle}
                onChange={(e) =>
                  setWorkStyle(e.target.value as typeof workStyle)
                }
              >
                <option value="all">すべて</option>
                {Object.entries(stylesLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {kind === "job" ? (
              <>
                <label>
                  雇用形態
                  <select
                    value={employmentType}
                    onChange={(e) =>
                      setEmploymentType(
                        e.target.value as EmploymentType | "all",
                      )
                    }
                  >
                    <option value="all">すべて</option>
                    {Object.entries(employmentLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  給与単位
                  <select
                    value={salaryPeriod}
                    onChange={(e) =>
                      setSalaryPeriod(e.target.value as SalaryPeriod | "all")
                    }
                  >
                    <option value="all">すべて</option>
                    {Object.entries(periodLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  最低給与
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                  />
                </label>
                <label>
                  リモート条件
                  <input
                    value={remote}
                    placeholder="フルリモート"
                    onChange={(e) => setRemote(e.target.value)}
                  />
                </label>
              </>
            ) : null}
            {view === "discover" ? (
              <button onClick={() => void createSearch()}>検索を保存</button>
            ) : null}
          </section>
          {view === "saved" ? (
            <SavedSearches
              searches={searches}
              setSearches={setSearches}
              setNotice={setNotice}
            />
          ) : null}
          {view === "saved" && recommended.length ? (
            <section className={styles.recommend}>
              <h2>おすすめ</h2>
              <div className={styles.grid}>
                {recommended.slice(0, 3).map((x) => (
                  <ListingCard
                    key={x.id}
                    listing={x}
                    onOpen={() => setDialog({ type: "detail", listing: x })}
                    onSave={save}
                  />
                ))}
              </div>
            </section>
          ) : null}
          <div className={styles.resultHeading} id="work-listing-results">
            <div>
              <h2>
                {view === "manage"
                  ? mode === "jobs"
                    ? "求人掲載の管理"
                    : "依頼・出品の管理"
                  : view === "saved"
                    ? mode === "jobs"
                      ? "保存した求人"
                      : "保存した依頼・スキル"
                    : mode === "jobs"
                      ? "公開中の求人"
                      : kind === "request"
                        ? "公開中の依頼"
                        : kind === "service"
                          ? "公開中のスキル出品"
                          : "依頼・スキル出品"}
              </h2>
              <p>
                {view === "manage"
                  ? "品質、反応、公開状態を管理できます。"
                  : mode === "jobs"
                    ? "雇用条件と掲載者情報を確認してから応募してください。"
                    : "予算、納期、提供範囲を確認してから相談してください。"}
              </p>
            </div>
            <strong>{visible.length}件</strong>
          </div>
          {loading ? (
            <div className={styles.state}>読み込み中…</div>
          ) : error ? (
            <div className={styles.state} role="alert">
              <strong>読み込めませんでした</strong>
              <p>{error}</p>
              <button onClick={() => void load()}>再試行</button>
            </div>
          ) : visible.length ? (
            <section className={styles.grid}>
              {visible.map((x) =>
                view === "manage" ? (
                  <ManageCard
                    key={x.id}
                    listing={x}
                    analytics={analytics[x.id]}
                    loadAnalytics={async () => {
                      try {
                        const a = await json<{
                          totals: {
                            listViews: number;
                            detailViews: number;
                            inquiries: number;
                          };
                        }>(`/api/work-listings/${x.id}/analytics`);
                        setAnalytics((v) => ({
                          ...v,
                          [x.id]: {
                            views: a.totals.listViews + a.totals.detailViews,
                            inquiries: a.totals.inquiries,
                            saves: 0,
                          },
                        }));
                      } catch (e) {
                        setNotice(
                          e instanceof Error
                            ? e.message
                            : "分析を取得できませんでした",
                        );
                      }
                    }}
                    action={(a, e) => void listingAction(x, a, e)}
                    edit={() => setDialog({ type: "form", listing: x })}
                    setNotice={setNotice}
                  />
                ) : (
                  <ListingCard
                    key={x.id}
                    listing={x}
                    onOpen={() => setDialog({ type: "detail", listing: x })}
                    onSave={save}
                  />
                ),
              )}
            </section>
          ) : (
            <div className={styles.state}>
              <strong>
                {mode === "jobs"
                  ? "該当する求人はありません"
                  : "該当する依頼・スキル出品はありません"}
              </strong>
              <p>
                {mode === "jobs"
                  ? "検索条件を変更するか、新しい求人の通知条件を保存してください。"
                  : "条件を変更するか、新しい依頼・スキル出品を作成してください。"}
              </p>
            </div>
          )}
        </>
      ) : (
        <Messages
          scope={scope}
          setScope={setScope}
          threads={threads}
          selected={selected}
          messages={messages}
          open={openThread}
          send={sendMessage}
          status={status}
          error={threadError}
          retry={() => void loadThreads(scope)}
        />
      )}
      {dialog ? (
        <DialogBox
          title={mode === "jobs" ? "求人" : "依頼・スキル"}
          onClose={() => setDialog(null)}
        >
          {dialog.type === "form" ? (
            <ListingForm
              listing={dialog.listing}
              allowedKinds={allowedKinds}
              mode={mode}
              draftKey={
                mode === "jobs" ? JOB_DRAFT_KEY : CROWDSOURCING_DRAFT_KEY
              }
              onClose={() => setDialog(null)}
              onSaved={(x) => {
                setListings((v) =>
                  dialog.listing
                    ? v.map((y) => (y.id === x.id ? x : y))
                    : [x, ...v],
                );
                setDialog(null);
                setView("manage");
              }}
            />
          ) : dialog.type === "detail" ? (
            <Detail
              listing={dialog.listing}
              close={() => setDialog(null)}
              save={save}
              edit={() => setDialog({ type: "form", listing: dialog.listing })}
              inquire={() =>
                setDialog({ type: "inquiry", listing: dialog.listing })
              }
              report={() =>
                setDialog({ type: "report", listing: dialog.listing })
              }
            />
          ) : (
            <QuickForm
              type={dialog.type}
              listing={dialog.listing}
              close={() =>
                setDialog({ type: "detail", listing: dialog.listing })
              }
              done={(x) => {
                setNotice(x);
                setDialog(null);
              }}
            />
          )}
        </DialogBox>
      ) : null}
    </section>
  );
}

function SavedSearches({
  searches,
  setSearches,
  setNotice,
}: {
  searches: SavedSearch[];
  setSearches: (x: SavedSearch[]) => void;
  setNotice: (x: string) => void;
}) {
  async function toggle(x: SavedSearch) {
    try {
      const r = await json<{ search: SavedSearch }>(
        `/api/work-listings/saved-searches`,
        {
          method: "PUT",
          body: JSON.stringify({
            id: x.id,
            name: x.name,
            filters: x.filters,
            notificationEnabled: !x.notificationEnabled,
          }),
        },
      );
      setSearches(searches.map((y) => (y.id === x.id ? r.search : y)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "更新できませんでした");
    }
  }
  async function remove(x: SavedSearch) {
    try {
      await json(
        `/api/work-listings/saved-searches?id=${encodeURIComponent(x.id)}`,
        { method: "DELETE" },
      );
      setSearches(searches.filter((y) => y.id !== x.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "削除できませんでした");
    }
  }
  return (
    <section className={styles.savedSearches}>
      <h2>保存した検索</h2>
      {searches.length ? (
        searches.map((x) => (
          <article key={x.id}>
            <div>
              <strong>{x.name}</strong>
              <small>{x.matchCount ?? 0}件の一致</small>
            </div>
            <button
              aria-pressed={x.notificationEnabled}
              onClick={() => void toggle(x)}
            >
              通知 {x.notificationEnabled ? "ON" : "OFF"}
            </button>
            <a
              href={`/api/work-listings/saved-searches?matches=${encodeURIComponent(x.id)}`}
            >
              一致を見る
            </a>
            <button onClick={() => void remove(x)}>削除</button>
          </article>
        ))
      ) : (
        <p>保存した検索はありません。</p>
      )}
    </section>
  );
}
function ManageCard({
  listing,
  analytics,
  loadAnalytics,
  action,
  edit,
  setNotice,
}: {
  listing: WorkListing;
  analytics?: Analytics;
  loadAnalytics: () => void;
  action: (x: string, e?: Record<string, unknown>) => void;
  edit: () => void;
  setNotice: (x: string) => void;
}) {
  return (
    <article className={styles.manageCard}>
      <header>
        <div>
          <span className={styles.status}>{statuses[listing.status]}</span>
          <h2>{listing.title}</h2>
        </div>
        <strong className={styles.score}>
          品質 {listing.qualityScore ?? 0}/100
        </strong>
      </header>
      {listing.qualityHints?.length ? (
        <ul>
          {listing.qualityHints.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.good}>主要な掲載情報が揃っています。</p>
      )}
      <div className={styles.actions}>
        <button onClick={edit}>編集</button>
        <button onClick={() => action("duplicate")}>複製</button>
        <button
          onClick={() => {
            const d = prompt(
              "新しい期限（YYYY-MM-DD）",
              listing.deadline?.slice(0, 10) || "",
            );
            if (d) action("deadline", { deadline: d });
          }}
        >
          期限延長
        </button>
        <button onClick={loadAnalytics}>分析</button>
        {listing.status === "published" ? (
          <button onClick={() => action("pause")}>停止</button>
        ) : (
          <button className={styles.primary} onClick={() => action("publish")}>
            公開
          </button>
        )}
      </div>
      {analytics ? (
        <dl className={styles.analytics}>
          <div>
            <dt>閲覧</dt>
            <dd>{analytics.views}</dd>
          </div>
          <div>
            <dt>保存</dt>
            <dd>{analytics.saves}</dd>
          </div>
          <div>
            <dt>問い合わせ</dt>
            <dd>{analytics.inquiries}</dd>
          </div>
        </dl>
      ) : null}
    </article>
  );
}
function Messages({
  scope,
  setScope,
  threads,
  selected,
  messages,
  open,
  send,
  status,
  error,
  retry,
}: {
  scope: Scope;
  setScope: (x: Scope) => void;
  threads: Thread[];
  selected: Thread | null;
  messages: Message[];
  open: (x: Thread) => void;
  send: (e: FormEvent<HTMLFormElement>) => void;
  status: (x: WorkApplicationStatus) => void;
  error: string;
  retry: () => void;
}) {
  return (
    <section className={styles.messages}>
      <header>
        <div>
          <h2>メッセージ</h2>
          <p>業務委託案件について、当事者間の会話を確認できます。</p>
        </div>
        <div>
          <button
            className={scope === "received" ? styles.active : ""}
            onClick={() => setScope("received")}
          >
            受信
          </button>
          <button
            className={scope === "sent" ? styles.active : ""}
            onClick={() => setScope("sent")}
          >
            送信済み
          </button>
        </div>
      </header>
      <div className={styles.messageLayout}>
        <aside aria-label="会話一覧">
          {error ? (
            <div className={styles.state} role="alert">
              <p>{error}</p>
              <button type="button" onClick={retry}>再試行</button>
            </div>
          ) : threads.length ? (
            threads.map((x) => (
              <button
                key={x.id}
                className={selected?.id === x.id ? styles.selected : ""}
                onClick={() => void open(x)}
              >
                <strong>{x.listingTitle}</strong>
                <span>
                  {statuses[x.status || "new"]}
                  {x.unread ? "・未読" : ""}
                </span>
                <small>{date(x.updatedAt || x.createdAt)}</small>
              </button>
            ))
          ) : (
            <p>会話はありません。</p>
          )}
        </aside>
        <section className={styles.thread}>
          {selected ? (
            <>
              <header>
                <div>
                  <h3>{selected.listingTitle}</h3>
                  <span>{statuses[selected.status || "new"]}</span>
                </div>
                {scope === "received" ? (
                  <div>
                    <button onClick={() => void status("reviewing")}>
                      検討中
                    </button>
                    <button onClick={() => void status("accepted")}>
                      成立
                    </button>
                    <button onClick={() => void status("declined")}>
                      辞退
                    </button>
                  </div>
                ) : (
                  <button onClick={() => void status("withdrawn")}>
                    取り下げ
                  </button>
                )}
              </header>
              <div className={styles.bubbles}>
                {messages.map((x) => (
                  <article
                    key={x.id}
                    className={x.sentByViewer ? styles.own : ""}
                  >
                    <p>{x.body}</p>
                    <small>{date(x.createdAt)}</small>
                  </article>
                ))}
              </div>
              <form onSubmit={send}>
                <label>
                  返信
                  <textarea
                    name="body"
                    required
                    minLength={1}
                    maxLength={2000}
                  />
                </label>
                <button className={styles.primary}>送信</button>
              </form>
            </>
          ) : (
            <div className={styles.state}>会話を選択してください。</div>
          )}
        </section>
      </div>
    </section>
  );
}
function Detail({
  listing,
  close,
  save,
  edit,
  inquire,
  report,
}: {
  listing: WorkListing;
  close: () => void;
  save: (x: WorkListing) => void;
  edit: () => void;
  inquire: () => void;
  report: () => void;
}) {
  /* 見ている面の中に留まる。v2 から見ているなら /v2/profile/… へ。 */
  const surface = useHubUiSurface();
  return (
    <article className={styles.detail}>
      <header>
        <div>
          <small>
            {kinds[listing.kind]}・
            {workCategoryLabel(
              listing.kind === "job" ? "jobs" : "crowdsourcing",
              listing.category,
            )}
          </small>
          <h2>{listing.title}</h2>
        </div>
        <button className={styles.close} onClick={close} aria-label="閉じる">
          ×
        </button>
      </header>
      <a
        className={styles.owner}
        href={hubSurfacePath(surface, `/profile/${encodeURIComponent(listing.ownerHandle)}`)}
      >
        {listing.ownerName} @{listing.ownerHandle}
      </a>
      {listing.ownerTrust ? (
        <div className={styles.trust} aria-label="掲載者の公開実績">
          <span>
            Hub参加{" "}
            {new Intl.DateTimeFormat("ja-JP", {
              year: "numeric",
              month: "short",
            }).format(new Date(listing.ownerTrust.memberSince))}
          </span>
          {listing.ownerTrust.responseRate != null ? (
            <span>返信率 {listing.ownerTrust.responseRate}%</span>
          ) : null}
          {listing.ownerTrust.completedCount != null ? (
            <span>成立実績 {listing.ownerTrust.completedCount}件</span>
          ) : null}
        </div>
      ) : null}
      <p className={styles.detailSummary}>{listing.summary}</p>
      {listing.kind === "job" && jobDetails(listing as JobListing)
        ? (() => {
            const job = jobDetails(listing as JobListing)!;
            return (
              <section className={styles.jobDetail} aria-label="求人条件">
                <div className={styles.companyLine}>
                  <strong>{job.companyName}</strong>
                  <span>
                    {job.verification === "self_reported"
                      ? "自己申告情報"
                      : "確認済み"}
                  </span>
                </div>
                <dl className={styles.detailFacts}>
                  <div>
                    <dt>職種</dt>
                    <dd>{job.occupation}</dd>
                  </div>
                  <div>
                    <dt>給与</dt>
                    <dd>{salaryLabel(job)}</dd>
                  </div>
                  <div>
                    <dt>雇用形態</dt>
                    <dd>{employmentLabels[job.employmentType]}</dd>
                  </div>
                  <div>
                    <dt>勤務地</dt>
                    <dd>{job.location}</dd>
                  </div>
                  <div>
                    <dt>リモート</dt>
                    <dd>{job.remote || "記載なし"}</dd>
                  </div>
                  <div>
                    <dt>勤務時間</dt>
                    <dd>{job.hours || "記載なし"}</dd>
                  </div>
                  <div>
                    <dt>休日</dt>
                    <dd>{job.holidays || "記載なし"}</dd>
                  </div>
                  <div>
                    <dt>募集人数</dt>
                    <dd>{job.openings}名</dd>
                  </div>
                  <div>
                    <dt>業務変更範囲</dt>
                    <dd>{job.dutiesChangeScope || "記載なし"}</dd>
                  </div>
                  <div>
                    <dt>勤務地変更範囲</dt>
                    <dd>{job.locationChangeScope || "記載なし"}</dd>
                  </div>
                  <div>
                    <dt>更新基準・上限</dt>
                    <dd>{job.renewalCriteria || "該当なし・記載なし"}</dd>
                  </div>
                  <div>
                    <dt>試用期間</dt>
                    <dd>{job.probation || "記載なし"}</dd>
                  </div>
                </dl>
                {job.business ? (
                  <p>
                    <strong>事業内容</strong>
                    <br />
                    {job.business}
                  </p>
                ) : null}
                <p className={styles.legalNote}>
                  この表示は開発中で、法定表示への完全対応を保証するものではありません。本番有効化前に別途法務レビューが必要です。
                </p>
              </section>
            );
          })()
        : null}
      <dl className={styles.detailFacts}>
        <div>
          <dt>報酬・予算</dt>
          <dd>{listing.compensationLabel}</dd>
        </div>
        <div>
          <dt>働き方</dt>
          <dd>{stylesLabel[listing.workStyle]}</dd>
        </div>
        <div>
          <dt>募集期限</dt>
          <dd>{date(listing.deadline)}</dd>
        </div>
        <div>
          <dt>稼働量</dt>
          <dd>{listing.workload || "応相談"}</dd>
        </div>
      </dl>
      <aside className={styles.safety}>
        <strong>安全案内</strong>
        <p>
          掲載者プロフィールを確認し、条件は書面で合意してください。Hubが取引成立や支払いを保証するものではありません。
        </p>
      </aside>
      {listing.kind !== "job" ? (
        <WorkEscrowPanel
          listingId={listing.id}
          suggestedBudget={listing.budgetAmount}
        />
      ) : null}
      <footer>
        {listing.ownedByViewer ? (
          <button onClick={edit}>編集</button>
        ) : (
          <>
            <button onClick={() => void save(listing)}>
              {listing.savedByViewer ? "保存解除" : "保存"}
            </button>
            <button onClick={report}>通報</button>
            {listing.kind === "job" ? (
              jobDetails(listing as JobListing)?.companySite ? (
                <a
                  className={styles.primary}
                  href={jobDetails(listing as JobListing)?.companySite}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  事業者サイトで応募
                </a>
              ) : (
                <button className={styles.primary} disabled>
                  応募先が未登録です
                </button>
              )
            ) : (
              <button
              className={styles.primary}
              disabled={listing.acceptingApplications === false}
              onClick={inquire}
            >
              {listing.acceptingApplications === false
                ? "受付終了"
                : "問い合わせ"}
              </button>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
function QuickForm({
  type,
  listing,
  close,
  done,
}: {
  type: "inquiry" | "report";
  listing: WorkListing;
  close: () => void;
  done: (x: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      await json(
        `/api/work-listings/${listing.id}/${type === "inquiry" ? "inquiries" : "reports"}`,
        { method: "POST", body: JSON.stringify(Object.fromEntries(f)) },
      );
      done(
        type === "inquiry"
          ? "問い合わせを送信しました。"
          : "通報を受け付けました。",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <header>
        <h2>{type === "inquiry" ? "問い合わせ" : "掲載を通報"}</h2>
        <button type="button" className={styles.close} onClick={close}>
          ×
        </button>
      </header>
      {type === "inquiry" ? (
        <label>
          メッセージ
          <textarea
            name="message"
            required
            minLength={20}
            maxLength={2000}
            rows={8}
          />
        </label>
      ) : (
        <>
          <label>
            理由
            <select name="reason">
              <option value="misleading">誤解を招く内容</option>
              <option value="discrimination">差別的な条件</option>
              <option value="illegal">違法・危険な依頼</option>
              <option value="spam">スパム</option>
              <option value="other">その他</option>
            </select>
          </label>
          <label>
            詳細
            <textarea name="details" required minLength={10} maxLength={1000} />
          </label>
        </>
      )}
      {error ? <p className={styles.error}>{error}</p> : null}
      <footer>
        <button type="button" onClick={close}>
          戻る
        </button>
        <button className={styles.primary} disabled={busy}>
          {busy ? "送信中…" : "送信"}
        </button>
      </footer>
    </form>
  );
}
