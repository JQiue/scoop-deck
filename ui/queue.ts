import type { Signal } from "nsh";
import { Scoop, type InstallProgress } from "scoop-deck/native";
import { MAX_DOWNLOADS } from "./ui";
import { isCancelledError, type Job, type JobKind, type JobStatus } from "./types";

export function createQueue(input: {
  jobs: Signal<Job[]>;
  error: Signal<string | null>;
  recentlyDone: Signal<string | null>;
  notify: (text: string) => void;
  refreshAfterAction: () => Promise<void>;
}) {
  const { jobs, error, recentlyDone, notify, refreshAfterAction } = input;
  function jobOf(name: string, kind: JobKind): Job | undefined {
    return jobs().find((job) => job.name === name && job.kind === kind);
  }

  function setJob(name: string, kind: JobKind, patch: Partial<Job>) {
    jobs.set(
      jobs().map((job) =>
        job.name === name && job.kind === kind ? { ...job, ...patch } : job,
      ),
    );
  }

  function removeJob(name: string, kind: JobKind) {
    jobs.set(
      jobs().filter((job) => !(job.name === name && job.kind === kind)),
    );
  }

  /** 队列里还有没结束的任务（失败待重试的不算）。 */
  function pendingJobs(): number {
    return jobs().filter((job) => job.status !== "failed").length;
  }

  /** 一批任务的统计，用于最后的汇总提示。 */
  let batch = { ok: 0, failed: 0, total: 0 };

  /** 加入队列：下载最多 3 个并行，安装严格串行。 */
  function enqueue(job: { name: string; kind: JobKind }) {
    if (jobOf(job.name, job.kind)) {
      return;
    }

    if (pendingJobs() === 0) {
      batch = { ok: 0, failed: 0, total: 0 };
    }

    batch.total += 1;

    // 卸载不需要下载，直接排到安装队列。
    const status: JobStatus = job.kind === "uninstall" ? "ready" : "waiting";
    jobs.set([
      ...jobs(),
      { ...job, status, stage: "preparing", percent: null },
    ]);
    schedule();
  }

  function schedule() {
    const list = jobs();

    if (!list.some((job) => job.status === "installing")) {
      const ready = list.find((job) => job.status === "ready");

      if (ready) {
        void startInstall(ready);
      }
    }

    const downloads = list.filter(
      (job) => job.status === "downloading",
    ).length;

    if (downloads < MAX_DOWNLOADS) {
      const next = list.find(
        (job) => job.status === "waiting" && job.kind !== "uninstall",
      );

      if (next) {
        void startDownload(next);
      }
    }
  }

  async function startDownload(job: { name: string; kind: JobKind }) {
    setJob(job.name, job.kind, {
      status: "downloading",
      stage: "preparing",
      percent: null,
    });

    try {
      await Scoop.prefetch(job.name, (progress) => {
        setJob(job.name, job.kind, {
          status: "downloading",
          stage: progress.stage,
          percent: progress.percent ?? null,
        });
      });
      setJob(job.name, job.kind, { status: "ready", percent: 100 });
    } catch (cause) {
      if (isCancelledError(cause)) {
        removeJob(job.name, job.kind);
      } else {
        // 预下载失败也继续：让 Scoop 自己下载。
        setJob(job.name, job.kind, { status: "ready", percent: null });
      }
    }

    schedule();
  }

  /** 执行安装/卸载，把进度写进该任务，行内按钮随之变化。 */
  async function startInstall(job: { name: string; kind: JobKind }) {
    setJob(job.name, job.kind, {
      status: "installing",
      stage: "preparing",
      percent: null,
    });
    error.set(null);
    let outcome: "ok" | "failed" | "cancelled" = "ok";

    const onProgress = (progress: InstallProgress) => {
      setJob(job.name, job.kind, {
        status: "installing",
        stage: progress.stage,
        percent: progress.percent ?? null,
      });
    };

    try {
      if (job.kind === "install") {
        await Scoop.install(job.name, onProgress);
      } else if (job.kind === "update") {
        await Scoop.update(job.name, onProgress);
      } else {
        await Scoop.uninstall(job.name);
      }
    } catch (cause) {
      if (isCancelledError(cause)) {
        outcome = "cancelled";
        removeJob(job.name, job.kind);
      } else {
        outcome = "failed";
        // 失败的任务留在列表里，行内显示“重试”，错误详情在上方横幅。
        error.set(String(cause));
        setJob(job.name, job.kind, {
          status: "failed",
          stage: "failed",
          percent: null,
        });
      }
    } finally {
      if (outcome === "ok") {
        removeJob(job.name, job.kind);
        batch.ok += 1;
        recentlyDone.set(job.name);
        setTimeout(() => {
          if (recentlyDone() === job.name) {
            recentlyDone.set(null);
          }
        }, 2600);
      } else if (outcome === "failed") {
        batch.failed += 1;
      }

      await refreshAfterAction();
      schedule();

      // 整批结束才汇总，避免一次弹很多条。
      if (pendingJobs() === 0) {
        if (batch.total <= 1) {
          if (outcome === "ok") {
            notify(doneLabel(job));
          }
        } else {
          const parts = [`${batch.ok} 个成功`];

          if (batch.failed > 0) {
            parts.push(`${batch.failed} 个失败`);
          }

          notify(`批量完成：${parts.join("，")}`);
        }

        batch = { ok: 0, failed: 0, total: 0 };
      }
    }
  }

  function doneLabel(job: { name: string; kind: JobKind }): string {
    switch (job.kind) {
      case "install":
        return `已安装 ${job.name}`;
      case "update":
        return `已更新 ${job.name}`;
      default:
        return `已卸载 ${job.name}`;
    }
  }

  /** 重试失败的任务。 */
  function retryJob(name: string, kind: JobKind) {
    removeJob(name, kind);
    enqueue({ name, kind });
  }

  /** 排队中/待安装的直接移出队列；下载中/安装中的通知 Rust 取消。 */
  async function cancelJob(name: string, kind: JobKind) {
    const job = jobOf(name, kind);

    if (!job) {
      return;
    }

    if (
      job.status === "waiting" ||
      job.status === "ready" ||
      job.status === "failed"
    ) {
      removeJob(name, kind);
      schedule();
      return;
    }

    try {
      await Scoop.cancel(name);
    } catch (cause) {
      error.set(String(cause));
    }
  }

  return { jobOf, removeJob, enqueue, retryJob, cancelJob };
}
