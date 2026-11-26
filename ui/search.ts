import { computed } from "nsh";
import type { ScoopCatalogApp } from "scoop-deck/native";
import { MAX_RESULTS } from "./ui";
import { t } from "./i18n";

export function createSearch(input: {
  catalog: () => ScoopCatalogApp[];
  query: () => string;
}) {
  const { catalog, query } = input;
  const matched = computed(() => {
    const normalized = query().trim().toLowerCase();

    if (normalized === "") {
      return [];
    }

    const scored: { entry: ScoopCatalogApp; score: number }[] = [];

    for (const entry of catalog()) {
      const name = entry.name.toLowerCase();
      const score =
        name === normalized
          ? 0
          : name.startsWith(normalized)
            ? 1
            : name.includes(normalized)
              ? 2
              : entry.description.toLowerCase().includes(normalized)
                ? 3
                : -1;

      if (score >= 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      // 同级里短名字优先（git 排在 github-desktop 前），再按字母序。
      if (left.entry.name.length !== right.entry.name.length) {
        return left.entry.name.length - right.entry.name.length;
      }

      const a = left.entry.name.toLowerCase();
      const b = right.entry.name.toLowerCase();

      return a < b ? -1 : a > b ? 1 : 0;
    });

    return scored.map((item) => item.entry);
  });
  const shown = computed(() => matched().slice(0, MAX_RESULTS));

  const hint = computed(() => {
    if (query().trim() === "") {
      return "";
    }

    const total = matched().length;

    if (total === 0) {
      return t("search.noMatch");
    }

    return total > MAX_RESULTS
      ? t("search.matchesLimited", { count: total, max: MAX_RESULTS })
      : t("search.matches", { count: total });
  });

  return { matched, shown, hint };
}
