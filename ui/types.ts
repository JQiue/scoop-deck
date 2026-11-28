import type { ScoopApp } from "scoop-deck/native";

export const TAB_INSTALLED = 0;
export const TAB_SEARCH = 1;
export const TAB_BUCKETS = 2;
export const TAB_SETTINGS = 3;

/** 已安装页筛选器的“全部 / 未知来源 / URL 清单”哨兵值。 */
export const FILTER_ALL_BUCKETS = "__all";
export const FILTER_UNKNOWN_BUCKET = "__unknown";
export const FILTER_URL_BUCKET = "__url";

export type InstalledStatus = "all" | "updatable" | "latest";

/** `bucket` 字段在 URL 清单安装时存的是清单地址。 */
export function isUrlSource(source: string): boolean {
  const value = source.trim().toLowerCase();
  return value.startsWith("https://") || value.startsWith("http://");
}

export function appBucketKey(app: ScoopApp): string {
  if (isUrlSource(app.bucket)) {
    return FILTER_URL_BUCKET;
  }

  return app.bucket.trim() === "" ? FILTER_UNKNOWN_BUCKET : app.bucket;
}

export function hasUpdate(app: ScoopApp): boolean {
  return !!app.latestVersion && app.latestVersion !== app.installedVersion;
}

/** 只在下载/准备阶段允许取消；校验、解压和收尾时杀 Scoop 会留下半个应用。 */
const CANCELABLE_STAGES = ["preparing", "downloading", "waiting"];

export function stageCanCancel(stage: string | undefined): boolean {
  return stage !== undefined && CANCELABLE_STAGES.includes(stage);
}

/** 该任务当前是否允许用户点击取消。 */
export function canCancelJob(job: Job): boolean {
  if (job.status === "failed") {
    return false;
  }

  return (
    job.status === "waiting" ||
    job.status === "ready" ||
    (job.kind !== "uninstall" && stageCanCancel(job.stage))
  );
}

/** Rust 侧主动取消时返回的错误是否匹配。 */
export function isCancelledError(cause: unknown): boolean {
  return String(cause).includes("已取消");
}

export type JobKind = "install" | "update" | "uninstall";

export type JobStatus = "waiting" | "downloading" | "ready" | "installing" | "failed";

export interface Job {
  name: string;
  kind: JobKind;
  status: JobStatus;
  stage: string;
  percent: number | null;
  /** 从 URL 清单安装时的清单地址；普通 bucket 任务没有。 */
  url?: string;
  /** 预下载失败后回退给 Scoop 下载。 */
  fallback?: boolean;
}
