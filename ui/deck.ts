import { Clipboard, context, signal } from "nsh";
import { toast } from "./omarchy";
import { confirm } from "./confirm";
import {
  Scoop,
  type ScoopApp,
  type ScoopBucket,
  type ScoopCatalogApp,
  type ScoopDetails,
  type ScoopKnownBucket,
} from "scoop-deck/native";
import { formatBytes } from "./ui";
import { createInstalledFilters } from "./filters";
import { createQueue } from "./queue";
import { createSearch } from "./search";
import { t } from "./i18n";
import {
  FILTER_ALL_BUCKETS,
  TAB_INSTALLED,
  hasUpdate,
  type InstalledStatus,
  type Job,
  type JobKind,
} from "./types";

export * from "./types";

const HTTP_URL = /^https?:\/\/\S+$/i;

/** 清单地址是否像 http(s) URL，并且能从文件名推导出应用名。 */
export function isManifestUrl(raw: string): boolean {
  return HTTP_URL.test(raw.trim()) && manifestAppName(raw) !== "";
}

/** Scoop 用清单文件名作为应用名：`.../foo.json` → `foo`。 */
export function manifestAppName(raw: string): string {
  const clean = raw.trim().split(/[?#]/, 1)[0].replace(/\/+$/, "");
  const base = clean.split("/").pop() ?? "";

  try {
    return decodeURIComponent(base).replace(/\.json$/i, "").trim();
  } catch {
    return "";
  }
}

export function createDeck() {
  const tab = signal(TAB_INSTALLED);
  /** null = 正在检查；false = 没装 Scoop；true = 可以正常加载。 */
  const scoopAvailable = signal<boolean | null>(null);
  const apps = signal<ScoopApp[]>([]);
  const loadingApps = signal(true);
  const catalog = signal<ScoopCatalogApp[]>([]);
  const loadingCatalog = signal(true);
  const buckets = signal<ScoopBucket[]>([]);
  const knownBuckets = signal<ScoopKnownBucket[]>([]);
  const loadingBuckets = signal(true);
  const query = signal("");
  const newBucket = signal("");
  const newBucketRepo = signal("");
  const editing = signal<string | null>(null);
  const editRepo = signal("");
  /** 正在估算下载大小的包（可多个，互不影响）。 */
  const preparing = signal<string[]>([]);
  /** 正在执行的任务；该行的按钮变成进度按钮。 */
  /** 所有任务：等待 → 下载 → 待安装 → 安装。 */
  const jobs = signal<Job[]>([]);
  /** 已安装页的筛选条件：关键词、更新状态、bucket。 */
  const installedQuery = signal("");
  const installedStatus = signal<InstalledStatus>("all");
  const bucketFilter = signal(FILTER_ALL_BUCKETS);
  /** 正在导入的 Scoopfile 路径（导入期间不再接受其它操作）。 */
  const importing = signal<string | null>(null);
  /** 正在执行 `scoop update`（更新 Scoop 与 bucket）。 */
  const updatingScoop = signal(false);
  /** 刚完成的任务，用来短暂高亮那一行。 */
  const recentlyDone = signal<string | null>(null);
  /** 详情面板 */
  const detailOpen = signal(false);
  const detailName = signal<string | null>(null);
  const detail = signal<ScoopDetails | null>(null);
  const detailLoading = signal(false);
  /** 复制包名后的短暂成功态。 */
  const copyDone = signal(false);
  const error = signal<string | null>(null);
  // 增删 bucket 会改变可安装包清单；重扫要读几千个 manifest，所以只在需要时做。
  let catalogChanged = false;

  async function loadInstalled() {
    if (scoopAvailable() !== true) {
      return;
    }

    loadingApps.set(true);
    try {
      apps.set(await Scoop.installed());
    } catch (cause) {
      error.set(String(cause));
    } finally {
      loadingApps.set(false);
    }
  }

  async function loadCatalog() {
    if (scoopAvailable() !== true) {
      return;
    }

    loadingCatalog.set(true);
    try {
      catalog.set(await Scoop.catalog());
    } catch (cause) {
      error.set(String(cause));
    } finally {
      loadingCatalog.set(false);
    }
  }

  async function loadBuckets() {
    if (scoopAvailable() !== true) {
      return;
    }

    loadingBuckets.set(true);
    try {
      buckets.set(await Scoop.buckets());
    } catch (cause) {
      error.set(String(cause));
    } finally {
      loadingBuckets.set(false);
    }
  }

  /** Scoop 内置的已知 bucket（含是否已启用）。 */
  async function loadKnownBuckets() {
    if (scoopAvailable() !== true) {
      return;
    }

    try {
      knownBuckets.set(await Scoop.knownBuckets());
    } catch (cause) {
      error.set(String(cause));
    }
  }

  /** 启动时先确认 Scoop 在不在；不在就停在引导页，不加载列表。 */
  async function checkScoop() {
    scoopAvailable.set(null);

    let available = false;

    try {
      available = await Scoop.available();
    } catch {
      available = false;
    }

    scoopAvailable.set(available);

    if (available) {
      await Promise.all([
        loadInstalled(),
        loadCatalog(),
        loadBuckets(),
        loadKnownBuckets(),
      ]);
    }
  }

  /** 右下角弹一条几秒后自动消失的提示。 */
  function notify(text: string) {
    toast({ title: text, timeout: 3500 });
  }

  /** 打开包详情面板。 */
  async function openDetails(name: string) {
    detailName.set(name);
    detail.set(null);
    detailLoading.set(true);
    copyDone.set(false);
    detailOpen.set(true);

    try {
      detail.set(await Scoop.details(name));
    } catch (cause) {
      error.set(String(cause));
      detailOpen.set(false);
      detailName.set(null);
    } finally {
      detailLoading.set(false);
    }
  }

  /** 复制包名：按钮短暂变成对勾，不再弹 toast。 */
  async function copyName(name: string) {
    try {
      await Clipboard.writeText(name);
      copyDone.set(true);
      setTimeout(() => copyDone.set(false), 1600);
    } catch (cause) {
      error.set(String(cause));
    }
  }

  /** 从详情面板直接安装（先收起面板再走确认框）。 */
  function installFromDetails() {
    const data = detail();

    if (!data) {
      return;
    }

    closeDetails();
    void installApp({
      name: data.name,
      version: data.version,
      description: data.description,
      bucket: data.bucket,
    });
  }

  /** 从详情面板直接更新。 */
  function updateFromDetails() {
    const data = detail();

    if (!data) {
      return;
    }

    closeDetails();
    void updateApp({
      name: data.name,
      installedVersion: data.installedVersion,
      latestVersion: data.version,
      description: data.description,
      bucket: data.bucket,
    });
  }

  /** 关闭面板：先播完退出动画，再丢掉内容。 */
  function closeDetails() {
    detailOpen.set(false);
    setTimeout(() => {
      if (!detailOpen()) {
        detailName.set(null);
        detail.set(null);
      }
    }, 300);
  }

  /** 操作结束后刷新受影响的列表。 */
  async function refreshAfterAction() {
    await Promise.all([loadInstalled(), loadBuckets(), loadKnownBuckets()]);

    if (catalogChanged) {
      catalogChanged = false;
      await loadCatalog();
    }
  }

  /** bucket 之类的一次性操作：执行期间不接受另一个。 */
  async function runAction(action: () => Promise<void>) {
    if (isBusy()) {
      return;
    }

    error.set(null);

    try {
      await action();
    } catch (cause) {
      error.set(String(cause));
    } finally {
      void refreshAfterAction();
    }
  }

  /** 有任务正在下载或安装。 */
  function isBusy(): boolean {
    return (
      importing() !== null ||
      updatingScoop() ||
      jobs().some(
        (job) => job.status === "downloading" || job.status === "installing",
      )
    );
  }

  const queue = createQueue({
    jobs,
    error,
    recentlyDone,
    notify,
    refreshAfterAction,
  });
  const { jobOf, enqueue } = queue;

  /** 预览并确认安装：先算出要下载多少，再弹确认框。 */
  async function installApp(app: ScoopCatalogApp) {
    if (preparing().includes(app.name) || jobOf(app.name, "install")) {
      return;
    }

    preparing.set([...preparing(), app.name]);
    let size = 0;

    try {
      size = await Scoop.downloadSize(app.name);
    } catch {
      size = 0;
    } finally {
      preparing.set(preparing().filter((name) => name !== app.name));
    }

    const ok = await confirm({
      title: t("deck.installTitle", { name: app.name }),
      description: t("deck.installDesc", {
        bucket: app.bucket,
        version: app.version,
        size:
          size > 0
            ? t("deck.sizeKnown", { size: formatBytes(size) })
            : t("deck.sizeUnknown"),
      }),
      actionLabel: t("common.install"),
      cancelLabel: t("common.cancel"),
    });

    if (ok) {
      enqueue({ name: app.name, kind: "install" });
    }
  }

  /** 从 URL 清单安装：不预下载，Scoop 自己下载并输出进度。 */
  function installFromUrl(rawUrl: string) {
    const url = rawUrl.trim();
    const name = manifestAppName(url);

    if (!isManifestUrl(url) || !name) {
      error.set(t("search.urlInvalid"));
      return;
    }

    if (jobOf(name, "install")) {
      return;
    }

    enqueue({ name, kind: "install", url });
  }

  /** 把有更新的包全部排队（先确认一次）。列表来自当前筛选结果。 */
  async function updateAll(list: ScoopApp[]) {
    if (list.length === 0) {
      return;
    }

    const names = list
      .slice(0, 6)
      .map((app) => app.name)
      .join(t("deck.listSeparator"));
    const more = list.length > 6 ? t("deck.updateAllMore") : "";
    const ok = await confirm({
      title: t("deck.updateAllTitle", { count: list.length }),
      description: t("deck.updateAllDesc", { names, more }),
      actionLabel: t("deck.startUpdate"),
      cancelLabel: t("common.cancel"),
    });

    if (!ok) {
      return;
    }

    for (const app of list) {
      enqueue({ name: app.name, kind: "update" });
    }
  }

  /** 预览并确认更新：同样先报下载大小。 */
  async function updateApp(app: ScoopApp) {
    if (preparing().includes(app.name) || jobOf(app.name, "update")) {
      return;
    }

    preparing.set([...preparing(), app.name]);
    let size = 0;

    try {
      size = await Scoop.downloadSize(app.name);
    } catch {
      size = 0;
    } finally {
      preparing.set(preparing().filter((name) => name !== app.name));
    }

    const ok = await confirm({
      title: t("deck.updateTitle", { name: app.name }),
      description: t("deck.updateDesc", {
        from: app.installedVersion,
        to: app.latestVersion ?? t("deck.updateLatest"),
        size:
          size > 0
            ? t("deck.sizeKnown", { size: formatBytes(size) })
            : t("deck.sizeUnknown"),
      }),
      actionLabel: t("common.update"),
      cancelLabel: t("common.cancel"),
    });

    if (ok) {
      enqueue({ name: app.name, kind: "update" });
    }
  }

  async function uninstallApp(name: string) {
    if (jobOf(name, "uninstall")) {
      return;
    }

    const ok = await confirm({
      title: t("deck.uninstallTitle"),
      description: t("deck.uninstallDesc", { name }),
      actionLabel: t("common.uninstall"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });

    if (ok) {
      enqueue({ name, kind: "uninstall" });
    }
  }

  async function addBucket() {
    const name = newBucket().trim();

    if (isBusy() || !name) {
      return;
    }

    const repo = newBucketRepo().trim();
    catalogChanged = true;
    // 乐观清空输入框；失败时错误显示在顶部，用户重填即可。
    newBucket.set("");
    newBucketRepo.set("");

    await runAction(() => Scoop.addBucket(name, repo || undefined));
  }

  /** 添加一个已知 bucket：等价于 `scoop bucket add <name>`。 */
  async function addKnownBucket(name: string) {
    if (isBusy()) {
      return;
    }

    catalogChanged = true;
    await runAction(() => Scoop.addBucket(name, undefined));
  }

  async function removeBucket(name: string) {
    if (isBusy()) {
      return;
    }

    const ok = await confirm({
      title: t("deck.bucketRemoveTitle"),
      description: t("deck.bucketRemoveDesc", { name }),
      actionLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });

    if (ok) {
      catalogChanged = true;
      await runAction(() => Scoop.removeBucket(name));
    }
  }

  function startEdit(bucket: ScoopBucket) {
    if (isBusy()) {
      return;
    }

    editRepo.set(bucket.source ?? "");
    editing.set(bucket.name);
  }

  async function saveBucket() {
    const name = editing();
    const url = editRepo().trim();

    if (!name || !url || isBusy()) {
      return;
    }

    error.set(null);

    try {
      await Scoop.setBucketSource(name, url);
      // 保存成功后收起编辑栏；失败则保留，用户改完可以重试。
      editing.set(null);
    } catch (cause) {
      error.set(String(cause));
    } finally {
      void refreshAfterAction();
    }
  }

  /** 导入 Scoopfile 后：清单可能变了，下一次刷新时重扫。 */
  async function refreshAfterImport() {
    catalogChanged = true;
    await Promise.all([loadInstalled(), loadBuckets()]);
  }

  const filters = createInstalledFilters({
    apps,
    installedQuery,
    installedStatus,
    bucketFilter,
  });
  const search = createSearch({ catalog, query });

  return {
    tab,
    scoopAvailable,
    apps,
    loadingApps,
    catalog,
    loadingCatalog,
    buckets,
    knownBuckets,
    loadingBuckets,
    query,
    newBucket,
    newBucketRepo,
    editing,
    editRepo,
    preparing,
    jobs,
    installedQuery,
    installedStatus,
    bucketFilter,
    importing,
    updatingScoop,
    recentlyDone,
    detailOpen,
    detailName,
    detail,
    detailLoading,
    copyDone,
    error,
    loadInstalled,
    loadCatalog,
    loadBuckets,
    checkScoop,
    notify,
    openDetails,
    copyName,
    installFromDetails,
    updateFromDetails,
    closeDetails,
    refreshAfterAction,
    runAction,
    isBusy,
    jobOf: queue.jobOf,
    removeJob: queue.removeJob,
    retryJob: queue.retryJob,
    cancelJob: queue.cancelJob,
    installApp,
    installFromUrl,
    updateAll,
    updateApp,
    uninstallApp,
    addBucket,
    addKnownBucket,
    removeBucket,
    startEdit,
    saveBucket,
    refreshAfterImport,
    hasUpdate,
    ...filters,
    ...search,
  };
}

export type Deck = ReturnType<typeof createDeck>;

export const DeckContext = context<Deck | null>(null);

export function useDeck(): Deck {
  const deck = DeckContext();

  if (!deck) {
    throw new Error(t("deck.contextError"));
  }

  return deck;
}
