// `nsh test` runs this file in a headless runner built with the crate.
// It checks the shell that does not depend on this machine's Scoop data.
import { expect, open, test } from "nsh/test";

const START_HINT = /^(输入关键词开始搜索|Type a keyword to search)$/;
const CATALOG_HINT = /^(\d+ 个可安装包|\d+ installable packages)$/;
const MATCH_HINT = /^(匹配 \d+ 个|\d+ matches)/;

test("shows the scoop tabs and the search hint", async () => {
  const app = await open("../App.tsx");

  await app.waitFor("id:tab-search");
  await app.press("id:tab-search");
  await app.waitFor("id:search-input");

  expect(app.texts().some((text) => START_HINT.test(text))).toBe(true);
});

test("filters the catalog as the query changes", async () => {
  const app = await open("../App.tsx");

  await app.waitFor("id:tab-search");
  await app.press("id:tab-search");
  await app.waitFor("id:search-input");

  // 等清单加载完再输入：加载过程中重绘会吞掉输入事件。
  await app.waitUntil(
    () => app.texts().some((text) => CATALOG_HINT.test(text)),
    { timeout: 30000 },
  );

  await app.type("id:search-input", "a");
  // 输入事件在下一帧才到达状态，等提示文字变化再断言。
  await app.waitUntil(
    () => app.texts().some((text) => MATCH_HINT.test(text)),
  );

  // 组件体只跑一次，搜索提示和结果若忘了用 `computed`，会停留在初始状态。
  expect(app.value("id:search-input")).toBe("a");
  expect(app.texts().some((text) => START_HINT.test(text))).toBe(false);
});
