/** 名称完全匹配 0、前缀 1、名称包含 2、描述包含 3；不匹配 -1。 */
export function matchScore(
  name: string,
  description: string,
  keyword: string,
): number {
  const normalized = name.toLowerCase();

  if (normalized === keyword) {
    return 0;
  }

  if (normalized.startsWith(keyword)) {
    return 1;
  }

  if (normalized.includes(keyword)) {
    return 2;
  }

  if (description.toLowerCase().includes(keyword)) {
    return 3;
  }

  return -1;
}

/** 按同一套优先级排序：分数、名字长度（短名优先），再按字母序。 */
export function rankMatches<T extends { name: string; description: string }>(
  items: T[],
  keyword: string,
): T[] {
  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    const score = matchScore(item.name, item.description, keyword);

    if (score >= 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }

    const a = left.item.name.toLowerCase();
    const b = right.item.name.toLowerCase();

    // 同级里短名字优先（git 排在 github-desktop 前），再按字母序。
    if (a.length !== b.length) {
      return a.length - b.length;
    }

    return a < b ? -1 : a > b ? 1 : 0;
  });

  return scored.map((entry) => entry.item);
}
