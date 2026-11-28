import { computed } from "nsh";
import type { ScoopCatalogApp } from "scoop-deck/native";
import { MAX_RESULTS } from "./ui";
import { rankMatches } from "./match";
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

    return rankMatches(catalog(), normalized);
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
