"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { WorkListing } from "@/lib/work-listings";
import styles from "./work-listings-marketplace.module.css";

export type EmploymentType =
  "full_time" | "contract" | "part_time" | "temporary" | "intern" | "other";
export type SalaryPeriod = "hourly" | "monthly" | "annual";
export type JobStage =
  | "submitted"
  | "screening"
  | "interview"
  | "offer"
  | "hired"
  | "rejected"
  | "withdrawn";
export type JobDetails = {
  employmentType: EmploymentType;
  occupation: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
  hours: string;
  holidays: string;
  probation: string;
  location: string;
  transfer: string;
  remote: string;
  benefits: string;
  contractPeriod: string;
  dutiesChangeScope?: string;
  locationChangeScope?: string;
  renewalCriteria?: string;
  openings: number;
  companyName: string;
  business: string;
  companySize: string;
  companySite: string;
  recruiterLabel: string;
  verification: "self_reported";
  jobReviewStatus: "pending" | "approved" | "rejected";
  applicationsCount?: number;
  closedReason?: string | null;
};
export type JobListing = WorkListing & {
  job?: JobDetails;
  jobDetails?: JobDetails;
};
export type JobApplication = {
  id: string;
  listingId: string;
  listingTitle?: string;
  applicantName?: string;
  coverNote: string;
  experience: string;
  skills: string[];
  desiredConditions: string;
  availableFrom: string | null;
  status: JobStage;
  createdAt: string;
  updatedAt: string;
};

export const employmentLabels: Record<EmploymentType, string> = {
  full_time: "正社員",
  contract: "契約社員",
  part_time: "アルバイト・パート",
  temporary: "派遣",
  intern: "インターン",
  other: "その他",
};
export const periodLabels: Record<SalaryPeriod, string> = {
  hourly: "時給",
  monthly: "月給",
  annual: "年収",
};
export const stageLabels: Record<JobStage, string> = {
  submitted: "未確認",
  screening: "書類確認",
  interview: "面談",
  offer: "オファー",
  hired: "採用",
  rejected: "見送り",
  withdrawn: "辞退",
};
export const jobDetails = (listing: JobListing) =>
  listing.jobDetails ?? listing.job;
const yen = new Intl.NumberFormat("ja-JP");
export function salaryLabel(job?: JobDetails) {
  if (!job) return "給与情報なし";
  const min = job.salaryMin == null ? "" : yen.format(job.salaryMin),
    max = job.salaryMax == null ? "" : yen.format(job.salaryMax);
  return `${job.salaryPeriod ? periodLabels[job.salaryPeriod] : "給与"} ${min}${min && max ? "〜" : ""}${max}円`.trim();
}

export function JobCardFacts({ listing }: { listing: JobListing }) {
  const job = jobDetails(listing);
  if (!job) return null;
  return (
    <dl className={styles.jobFacts}>
      <div>
        <dt>給与</dt>
        <dd>{salaryLabel(job)}</dd>
      </div>
      <div>
        <dt>勤務地</dt>
        <dd>{job.location || listing.location || "応相談"}</dd>
      </div>
      <div>
        <dt>雇用形態</dt>
        <dd>{employmentLabels[job.employmentType]}</dd>
      </div>
      <div>
        <dt>リモート</dt>
        <dd>{job.remote || "記載なし"}</dd>
      </div>
    </dl>
  );
}

export type JobDraft = {
  employmentType: EmploymentType;
  occupation: string;
  salaryMin: string;
  salaryMax: string;
  salaryPeriod: SalaryPeriod;
  hours: string;
  holidays: string;
  probation: string;
  location: string;
  transfer: string;
  remote: string;
  benefits: string;
  contractPeriod: string;
  dutiesChangeScope: string;
  locationChangeScope: string;
  renewalCriteria: string;
  openings: string;
  companyName: string;
  business: string;
  companySize: string;
  companySite: string;
  recruiterLabel: string;
};
export const emptyJobDraft: JobDraft = {
  employmentType: "full_time",
  occupation: "",
  salaryMin: "",
  salaryMax: "",
  salaryPeriod: "monthly",
  hours: "",
  holidays: "",
  probation: "",
  location: "",
  transfer: "",
  remote: "相談可",
  benefits: "",
  contractPeriod: "",
  dutiesChangeScope: "",
  locationChangeScope: "",
  renewalCriteria: "",
  openings: "1",
  companyName: "",
  business: "",
  companySize: "",
  companySite: "",
  recruiterLabel: "",
};
const templates: Record<
  string,
  Partial<JobDraft> & {
    title: string;
    category: string;
    skills: string;
    summary: string;
  }
> = {
  engineer: {
    title: "ソフトウェアエンジニア",
    category: "development",
    skills: "TypeScript, Web開発, Git",
    summary:
      "プロダクト開発を担当するエンジニアを募集します。担当業務、開発環境、チーム体制、期待する成果を具体的に記載してください。",
    employmentType: "full_time",
  },
  designer: {
    title: "プロダクトデザイナー",
    category: "design",
    skills: "Figma, UIデザイン, UXリサーチ",
    summary:
      "プロダクトの体験設計を担当するデザイナーを募集します。担当範囲、チーム体制、制作環境を具体的に記載してください。",
  },
  sales: {
    title: "法人営業",
    category: "marketing",
    skills: "法人営業, 顧客提案, CRM",
    summary:
      "顧客課題を理解し提案を行う営業担当を募集します。商材、担当領域、目標の考え方を具体的に記載してください。",
  },
  office: {
    title: "事務スタッフ",
    category: "operations",
    skills: "事務, 文書作成, 表計算",
    summary:
      "チームを支える事務スタッフを募集します。担当業務、使用ツール、引き継ぎ体制を具体的に記載してください。",
    employmentType: "part_time",
  },
};

export function JobFields({
  value,
  onChange,
  onTemplate,
}: {
  value: JobDraft;
  onChange: (value: JobDraft) => void;
  onTemplate: (template: {
    title: string;
    category: string;
    skills: string;
    summary: string;
  }) => void;
}) {
  function field<K extends keyof JobDraft>(key: K, v: JobDraft[K]) {
    onChange({ ...value, [key]: v });
  }
  function apply(key: string) {
    const t = templates[key];
    onChange({ ...value, ...t, occupation: t.title });
    onTemplate(t);
  }
  const warnings = useMemo(() => {
    const x: string[] = [];
    if (!value.salaryMin && !value.salaryMax)
      x.push("給与を入力してください。");
    if (!value.location) x.push("就業場所を入力してください。");
    if (!value.hours) x.push("勤務時間を入力してください。");
    if (!value.holidays) x.push("休日を入力してください。");
    if (!value.companyName) x.push("募集企業名を入力してください。");
    return x;
  }, [value]);
  return (
    <section className={styles.jobFormSection} aria-labelledby="job-conditions">
      <div className={styles.templateRow}>
        <strong>求人テンプレート</strong>
        {Object.entries({
          engineer: "エンジニア",
          designer: "デザイナー",
          sales: "営業",
          office: "事務",
        }).map(([k, l]) => (
          <button type="button" key={k} onClick={() => apply(k)}>
            {l}
          </button>
        ))}
      </div>
      <h3 id="job-conditions">雇用・労働条件</h3>
      <div className={styles.formGrid}>
        <label>
          職種
          <input
            required
            value={value.occupation}
            onChange={(e) => field("occupation", e.target.value)}
          />
        </label>
        <label>
          雇用形態
          <select
            value={value.employmentType}
            onChange={(e) =>
              field("employmentType", e.target.value as EmploymentType)
            }
          >
            {Object.entries(employmentLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          給与単位
          <select
            value={value.salaryPeriod}
            onChange={(e) =>
              field("salaryPeriod", e.target.value as SalaryPeriod)
            }
          >
            {Object.entries(periodLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          給与下限
          <input
            type="number"
            min="0"
            value={value.salaryMin}
            onChange={(e) => field("salaryMin", e.target.value)}
          />
        </label>
        <label>
          給与上限
          <input
            type="number"
            min="0"
            value={value.salaryMax}
            onChange={(e) => field("salaryMax", e.target.value)}
          />
        </label>
        <label>
          リモート可否
          <input
            value={value.remote}
            placeholder="フルリモート可"
            onChange={(e) => field("remote", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          就業場所
          <input
            required
            value={value.location}
            onChange={(e) => field("location", e.target.value)}
          />
        </label>
        <label>
          勤務時間
          <input
            required
            value={value.hours}
            placeholder="9:00〜18:00"
            onChange={(e) => field("hours", e.target.value)}
          />
        </label>
        <label>
          休日
          <input
            required
            value={value.holidays}
            placeholder="土日祝"
            onChange={(e) => field("holidays", e.target.value)}
          />
        </label>
        <label>
          契約期間
          <input
            value={value.contractPeriod}
            onChange={(e) => field("contractPeriod", e.target.value)}
          />
        </label>
        <label>
          試用期間
          <input
            value={value.probation}
            onChange={(e) => field("probation", e.target.value)}
          />
        </label>
        <label>
          転勤
          <input
            value={value.transfer}
            onChange={(e) => field("transfer", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          業務の変更範囲
          <input
            value={value.dutiesChangeScope}
            onChange={(e) => field("dutiesChangeScope", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          就業場所の変更範囲
          <input
            value={value.locationChangeScope}
            onChange={(e) => field("locationChangeScope", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          有期契約の更新基準・上限
          <input
            value={value.renewalCriteria}
            onChange={(e) => field("renewalCriteria", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          福利厚生
          <textarea
            rows={3}
            value={value.benefits}
            onChange={(e) => field("benefits", e.target.value)}
          />
        </label>
        <label>
          募集人数
          <input
            required
            type="number"
            min="1"
            max="1000"
            value={value.openings}
            onChange={(e) => field("openings", e.target.value)}
          />
        </label>
      </div>
      <h3>会社情報（自己申告）</h3>
      <div className={styles.formGrid}>
        <label>
          会社名
          <input
            required
            value={value.companyName}
            onChange={(e) => field("companyName", e.target.value)}
          />
        </label>
        <label>
          企業規模
          <input
            value={value.companySize}
            onChange={(e) => field("companySize", e.target.value)}
          />
        </label>
        <label>
          公式サイト
          <input
            type="url"
            placeholder="https://"
            value={value.companySite}
            onChange={(e) => field("companySite", e.target.value)}
          />
        </label>
        <label>
          採用担当表示
          <input
            value={value.recruiterLabel}
            onChange={(e) => field("recruiterLabel", e.target.value)}
          />
        </label>
        <label className={styles.full}>
          事業内容
          <textarea
            rows={3}
            value={value.business}
            onChange={(e) => field("business", e.target.value)}
          />
        </label>
      </div>
      {warnings.length ? (
        <aside className={styles.jobWarning} role="status">
          <strong>公開前に確認してください</strong>
          <ul>
            {warnings.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <aside className={styles.safety}>
        <strong>安全・公平な求人のために</strong>
        <p>
          会社情報は自己申告です。年齢、性別、国籍などによる不適切な応募制限や、金銭の先払い・口座提供・荷物転送を求める内容は掲載できません。本番有効化前に別途法務レビューが必要です。
        </p>
      </aside>
    </section>
  );
}

async function api<T>(url: string, init?: RequestInit) {
  const r = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error((d as { error?: string }).error || "操作できませんでした");
  return d as T;
}
export function JobApplicationForm({
  listing,
  close,
  done,
}: {
  listing: JobListing;
  close: () => void;
  done: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      await api(`/api/work-listings/jobs/${listing.id}/applications`, {
        method: "POST",
        body: JSON.stringify({
          ...Object.fromEntries(f),
          skills: String(f.get("skills") || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      });
      done("応募を送信しました。応募状況から選考状態を確認できます。");
    } catch (x) {
      setError(x instanceof Error ? x.message : "応募できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <header>
        <div>
          <small>求人への応募</small>
          <h2>{listing.title}</h2>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={close}
          aria-label="閉じる"
        >
          ×
        </button>
      </header>
      <p className={styles.help}>
        履歴書ファイルは収集しません。選考に必要な内容だけを入力してください。
      </p>
      <label>
        自己紹介
        <textarea
          name="coverNote"
          required
          minLength={20}
          maxLength={4000}
          rows={5}
        />
      </label>
      <label>
        経験
        <textarea name="experience" maxLength={4000} rows={6} />
      </label>
      <label>
        スキル（カンマ区切り）
        <input name="skills" placeholder="TypeScript, 顧客対応" />
      </label>
      <label>
        希望条件
        <textarea name="desiredConditions" maxLength={2000} rows={3} />
      </label>
      <label>
        勤務開始可能日
        <input name="availableFrom" type="date" />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button type="button" onClick={close}>
          戻る
        </button>
        <button className={styles.primary} disabled={busy}>
          {busy ? "送信中…" : "応募する"}
        </button>
      </footer>
    </form>
  );
}

export function JobApplications({
  listing,
  setNotice,
}: {
  listing: JobListing;
  setNotice: (x: string) => void;
}) {
  const [items, setItems] = useState<JobApplication[]>([]),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ applications: JobApplication[] }>(
      `/api/work-listings/jobs/${listing.id}/applications`,
    )
      .then((x) => setItems(x.applications || []))
      .catch((x) =>
        setNotice(
          x instanceof Error ? x.message : "応募を取得できませんでした",
        ),
      )
      .finally(() => setLoading(false));
  }, [listing.id, setNotice]);
  async function stage(item: JobApplication, value: JobStage) {
    try {
      const x = await api<{ application: JobApplication }>(
        `/api/work-listings/jobs/applications/${item.id}`,
        { method: "PATCH", body: JSON.stringify({ status: value }) },
      );
      setItems((v) => v.map((y) => (y.id === item.id ? x.application : y)));
    } catch (x) {
      setNotice(x instanceof Error ? x.message : "状態を更新できませんでした");
    }
  }
  async function remove(item: JobApplication) {
    if (!confirm("この応募情報を削除しますか？元に戻せません。")) return;
    try {
      await api(`/api/work-listings/jobs/applications/${item.id}`, {
        method: "DELETE",
      });
      setItems((v) => v.filter((x) => x.id !== item.id));
      setNotice("応募情報を削除しました。");
    } catch (x) {
      setNotice(x instanceof Error ? x.message : "削除できませんでした");
    }
  }
  return (
    <section className={styles.pipeline} aria-label="採用パイプライン">
      <h3>採用パイプライン</h3>
      {loading ? (
        <p>読み込み中…</p>
      ) : items.length ? (
        items.map((x) => (
          <article key={x.id}>
            <header>
              <strong>{x.applicantName || "応募者"}</strong>
              <span className={styles.status}>{stageLabels[x.status]}</span>
            </header>
            <p>{x.coverNote}</p>
            <details>
              <summary>応募内容</summary>
              <dl>
                <dt>経験</dt>
                <dd>{x.experience || "記載なし"}</dd>
                <dt>スキル</dt>
                <dd>{x.skills.join("、") || "記載なし"}</dd>
                <dt>希望条件</dt>
                <dd>{x.desiredConditions || "なし"}</dd>
                <dt>開始可能日</dt>
                <dd>{x.availableFrom || "応相談"}</dd>
              </dl>
            </details>
            <div className={styles.pipelineActions}>
              <label>
                選考状態
                <select
                  value={x.status}
                  onChange={(e) => void stage(x, e.target.value as JobStage)}
                >
                  {Object.entries(stageLabels)
                    .filter(([v]) => v !== "withdrawn")
                    .map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                </select>
              </label>
              <button type="button" onClick={() => void remove(x)}>
                応募情報を削除
              </button>
            </div>
          </article>
        ))
      ) : (
        <p>応募はまだありません。</p>
      )}
    </section>
  );
}

export function MyJobApplications({
  setNotice,
}: {
  setNotice: (x: string) => void;
}) {
  const [items, setItems] = useState<JobApplication[]>([]);
  useEffect(() => {
    void api<{ applications: JobApplication[] }>(
      "/api/work-listings/jobs/applications?role=applicant",
    )
      .then((x) => setItems(x.applications || []))
      .catch((x) =>
        setNotice(
          x instanceof Error ? x.message : "応募状況を取得できませんでした",
        ),
      );
  }, [setNotice]);
  async function remove(x: JobApplication) {
    if (!confirm("保存されている応募情報を削除しますか？")) return;
    try {
      await api(`/api/work-listings/jobs/applications/${x.id}`, {
        method: "DELETE",
      });
      setItems((v) => v.filter((y) => y.id !== x.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "削除できませんでした");
    }
  }
  return (
    <section className={styles.myApplications}>
      <h2>応募状況</h2>
      {items.length ? (
        items.map((x) => (
          <article key={x.id}>
            <div>
              <strong>{x.listingTitle || "求人"}</strong>
              <span className={styles.status}>{stageLabels[x.status]}</span>
            </div>
            <small>
              応募日{" "}
              {new Intl.DateTimeFormat("ja-JP").format(new Date(x.createdAt))}
            </small>
            <button onClick={() => void remove(x)}>応募情報を削除</button>
          </article>
        ))
      ) : (
        <p>応募した求人はありません。</p>
      )}
    </section>
  );
}
