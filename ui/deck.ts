import { Clipboard, context, signal } from "nsh";
import { confirm, toast } from "./omarchy";
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
import {
  FILTER_ALL_BUCKETS,
  TAB_INSTALLED,
  hasUpdate,
  type InstalledStatus,
  type Job,
  type JobKind,
} from "./types";

export * from "./types";

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
      title: `安装 ${app.name}？`,
      description: `来自 ${app.bucket} bucket 的 ${app.version}，${
        size > 0 ? `需要下载约 ${formatBytes(size)}` : "下载大小未知（由镜像或网络决定）"
      }。确认后加入队列，过程中可以随时取消。`,
      actionLabel: "安装",
      cancelLabel: "取消",
    });

    if (ok) {
      enqueue({ name: app.name, kind: "install" });
    }
  }

  /** 把有更新的包全部排队（先确认一次）。列表来自当前筛选结果。 */
  async function updateAll(list: ScoopApp[]) {
    if (list.length === 0) {
      return;
    }

    const names = list.slice(0, 6).map((app) => app.name).join("、");
    const more = list.length > 6 ? " 等" : "";
    const ok = await confirm({
      title: `更新 ${list.length} 个应用？`,
      description: `将依次更新：${names}${more}。下载最多 3 个并行，安装逐个进行；下载阶段可取消。`,
      actionLabel: "开始更新",
      cancelLabel: "取消",
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
      title: `更新 ${app.name}？`,
      description: `从 ${app.installedVersion} 更新到 ${
        app.latestVersion ?? "最新版本"
      }，${
        size > 0 ? `需要下载约 ${formatBytes(size)}` : "下载大小未知（由镜像或网络决定）"
      }。确认后加入队列，过程中可以随时取消。`,
      actionLabel: "更新",
      cancelLabel: "取消",
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
      title: "确认卸载",
      description: `确定要卸载 ${name} 吗？此操作不可撤销。`,
      actionLabel: "卸载",
      cancelLabel: "取消",
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
      title: "删除 bucket",
      description: `确定要删除 bucket ${name} 吗？会从本机移除它的清单，已安装的包不会被卸载；之后可以重新添加。`,
      actionLabel: "删除",
      cancelLabel: "取消",
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
    throw new Error("ScoopDeck 必须在 DeckContext.Provider 内渲染");
  }

  return deck;
}
