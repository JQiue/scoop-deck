// `nsh test` runs this file in a headless runner built with the crate.
// It checks the shell that does not depend on this machine's Scoop data.
import { expect, open, test } from "nsh/test";

const START_HINT = /^(输入关键词开始搜索|Type a keyword to search)$/;
const CATALOG_HINT = /^(\d+ 个可安装包|\d+ installable packages)$/;
const MATCH_HINT = /^(匹配 \d+ 个|\d+ matches)/;

// Keep the shell tests independent of the machine's Scoop installation.
let uninstalled = 0;
const NATIVE = {
  "Scoop.available": () => true,
  "Scoop.installed": () => [
    {
      name: "git",
      installedVersion: "2.46.0",
      latestVersion: "2.47.0",
      description: "Distributed version control system",
      bucket: "main",
    },
  ],
  "Scoop.buckets": () => [],
  "Scoop.knownBuckets": () => [],
  "Scoop.uninstall": () => {
    uninstalled += 1;
    return Promise.resolve();
  },
  "Scoop.catalog": () => [
    {
      name: "git",
      version: "2.47.0",
      description: "Distributed version control system",
      bucket: "main",
    },
    {
      name: "jq",
      version: "1.7.1",
      description: "Command-line JSON processor",
      bucket: "main",
    },
  ],
};

function openApp() {
  return open("../App.tsx", {
    modules: { "scoop-deck/native": NATIVE },
  });
}

test("shows the scoop tabs and the search hint", async () => {
  const app = await openApp();

  await app.waitFor("id:tab-search");
  await app.press("id:tab-search");
  await app.waitFor("id:search-input");

  expect(app.texts().some((text) => START_HINT.test(text))).toBe(true);
});

test("filters the catalog as the query changes", async () => {
  const app = await openApp();

  await app.waitFor("id:tab-search");
  await app.press("id:tab-search");
  await app.waitFor("id:search-input");

  // 等清单加载完再输入：加载过程中重绘会吞掉输入事件。
  await app.waitUntil(
    () => app.texts().some((text) => CATALOG_HINT.test(text)),
    { timeout: 30000 },
  );
  expect(
    app
      .texts()
      .some((text) => /^(2 个可安装包|2 installable packages)$/.test(text)),
  ).toBe(true);

  await app.type("id:search-input", "a");
  // 输入事件在下一帧才到达状态，等提示文字变化再断言。
  await app.waitUntil(
    () => app.texts().some((text) => MATCH_HINT.test(text)),
  );

  // 组件体只跑一次，搜索提示和结果若忘了用 `computed`，会停留在初始状态。
  expect(app.value("id:search-input")).toBe("a");
  expect(app.texts().some((text) => START_HINT.test(text))).toBe(false);
});

test("asks before uninstalling in a themed dialog", async () => {
  const app = await openApp();

  await app.waitFor("id:tab-installed");
  await app.press("label:Uninstall");
  await app.waitFor("text:Confirm uninstall");
  expect(app.texts()).toContain("Uninstall git? This cannot be undone.");

  // 取消后关闭，不进入队列。
  await app.press("text:Cancel");
  await app.waitUntil(() => !app.texts().includes("Confirm uninstall"));
});

test("uninstalls after the dialog is confirmed", async () => {
  uninstalled = 0;
  const app = await openApp();

  await app.waitFor("id:tab-installed");
  await app.press("label:Uninstall");
  await app.waitFor("text:Confirm uninstall");

  // 顶层弹窗里的“Uninstall”是确认按钮（表格行里的那个在其前面）。
  await app.press("role:dialog >> text:Uninstall");
  await app.waitUntil(() => uninstalled === 1, { timeout: 10000 });
  await app.waitUntil(() => app.texts().includes("Uninstalled git"), {
    timeout: 30000,
  });
});
