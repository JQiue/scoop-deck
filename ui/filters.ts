import { computed } from "nsh";
import type { ScoopApp } from "scoop-deck/native";
import { rankMatches } from "./match";
import { t } from "./i18n";
import {
  FILTER_ALL_BUCKETS,
  FILTER_UNKNOWN_BUCKET,
  FILTER_URL_BUCKET,
  appBucketKey,
  hasUpdate,
  type InstalledStatus,
} from "./types";

export function createInstalledFilters(input: {
  apps: () => ScoopApp[];
  installedQuery: () => string;
  installedStatus: () => InstalledStatus;
  bucketFilter: () => string;
}) {
  const { apps, installedQuery, installedStatus, bucketFilter } = input;
  const installedNames = computed(
    () => new Set(apps().map((app) => app.name)),
  );
  /** 有更新的应用。 */
  const updatable = computed(() => apps().filter(hasUpdate));
  /** 已安装页可选的 bucket（带数量，末尾放未知来源）。 */
  const bucketOptions = computed(() => {
    const counts = new Map<string, number>();

    for (const app of apps()) {
      const key = appBucketKey(app);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const entries = [...counts.entries()].sort(([left], [right]) => {
      if (left === FILTER_UNKNOWN_BUCKET) {
        return 1;
      }

      if (right === FILTER_UNKNOWN_BUCKET) {
        return -1;
      }

      return left.localeCompare(right);
    });

    return [
      { value: FILTER_ALL_BUCKETS, title: t("source.all", { count: apps().length }) },
      ...entries.map(([key, count]) => ({
        value: key,
        title:
          key === FILTER_UNKNOWN_BUCKET
            ? t("source.unknown", { count })
            : key === FILTER_URL_BUCKET
              ? t("source.url", { count })
              : `${key}（${count}）`,
      })),
    ];
  });
  /** 更新状态筛选器的选项。 */
  const statusOptions = computed(() => [
    { value: "all", title: t("source.all", { count: apps().length }) },
    {
      value: "updatable",
      title: t("source.updatable", { count: updatable().length }),
    },
    {
      value: "latest",
      title: t("source.latest", {
        count: apps().length - updatable().length,
      }),
    },
  ]);
  /** 已安装页当前显示的列表（关键词 + 更新状态 + bucket）。 */
  const listedApps = computed(() => {
    const keyword = installedQuery().trim().toLowerCase();
    const status = installedStatus();
    const bucket = bucketFilter();

    const filtered = apps().filter((app) => {
      if (status === "updatable" && !hasUpdate(app)) {
        return false;
      }

      if (status === "latest" && hasUpdate(app)) {
        return false;
      }

      if (bucket !== FILTER_ALL_BUCKETS && appBucketKey(app) !== bucket) {
        return false;
      }

      if (keyword !== "") {
        const name = app.name.toLowerCase();
        const description = app.description.toLowerCase();

        if (!name.includes(keyword) && !description.includes(keyword)) {
          return false;
        }
      }

      return true;
    });

    // 和搜索页共用同一套优先级：完全匹配 > 前缀 > 名称包含 > 描述包含。
    return keyword === "" ? filtered : rankMatches(filtered, keyword);
  });
  /** 是否设置了任意筛选条件。 */
  const filtersActive = computed(
    () =>
      installedQuery().trim() !== "" ||
      installedStatus() !== "all" ||
      bucketFilter() !== FILTER_ALL_BUCKETS,
  );
  /** 筛选按钮上显示的已启用条件数。 */
  const activeFilterCount = computed(
    () =>
      (installedQuery().trim() !== "" ? 1 : 0) +
      (installedStatus() !== "all" ? 1 : 0) +
      (bucketFilter() !== FILTER_ALL_BUCKETS ? 1 : 0),
  );
  /** 当前筛选结果里可更新的包（“全部更新”跟随筛选）。 */
  const visibleUpdatable = computed(() => listedApps().filter(hasUpdate));
  /** 筛选结果为空时该说什么。 */
  const emptyText = computed(() => {
    if (apps().length === 0) {
      return t("installed.empty");
    }

    if (
      installedStatus() === "updatable" &&
      installedQuery().trim() === "" &&
      bucketFilter() === FILTER_ALL_BUCKETS
    ) {
      return t("installed.allLatest");
    }

    return t("installed.noMatch");
  });

  return {
    installedNames,
    updatable,
    bucketOptions,
    statusOptions,
    listedApps,
    filtersActive,
    activeFilterCount,
    visibleUpdatable,
    emptyText,
  };
}
