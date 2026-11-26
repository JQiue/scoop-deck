import { appInfo, Clipboard, effect, Scroll, signal, Text, View } from "nsh";
import { Button, confirm, Panel, Select, Switch } from "./omarchy";
import { Scoop, type ScoopSettings } from "scoop-deck/native";
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from "./theme";
import {
  FIELD_W_WIDE,
  formatBytes,
  TextField,
  useCompact,
} from "./ui";
import { useDeck } from "./deck";

type FlagKey =
  | "aria2-enabled"
  | "aria2-fallback-enabled"
  | "use_external_7zip"
  | "use_lessmsi"
  | "ignore_running_processes"
  | "update_nightly"
  | "force_update"
  | "no_junction"
  | "use_git_history"
  | "autostash_on_conflict"
  | "debug";

type TextKey =
  | "proxy"
  | "github_proxy"
  | "default_architecture"
  | "shim"
  | "scoop_repo"
  | "scoop_branch";

type FlagField = {
  [K in keyof ScoopSettings]: ScoopSettings[K] extends boolean ? K : never;
}[keyof ScoopSettings];

type TextFieldKey = {
  [K in keyof ScoopSettings]: ScoopSettings[K] extends string ? K : never;
}[keyof ScoopSettings];

const FLAG_FIELD_MAP: Record<FlagKey, FlagField> = {
  "aria2-enabled": "aria2Enabled",
  "aria2-fallback-enabled": "aria2FallbackEnabled",
  use_external_7zip: "useExternal7zip",
  use_lessmsi: "useLessmsi",
  ignore_running_processes: "ignoreRunningProcesses",
  update_nightly: "updateNightly",
  force_update: "forceUpdate",
  no_junction: "noJunction",
  use_git_history: "useGitHistory",
  autostash_on_conflict: "autostashOnConflict",
  debug: "debug",
};

const TEXT_FIELD_MAP: Record<TextKey, TextFieldKey> = {
  proxy: "proxy",
  github_proxy: "githubProxy",
  default_architecture: "defaultArchitecture",
  shim: "shim",
  scoop_repo: "scoopRepo",
  scoop_branch: "scoopBranch",
};

interface Option {
  value: string;
  title: string;
}

export function SettingsTab() {
  const {
    isBusy,
    importing,
    updatingScoop,
    error,
    notify,
    refreshAfterImport,
  } = useDeck();
  const app = appInfo();
  const compact = useCompact();
  const settings = signal<ScoopSettings | null>(null);
  const drafts = signal<Record<string, string>>({});
  const savingKey = signal<string | null>(null);
  const exported = signal<string | null>(null);

  async function loadSettings() {
    try {
      settings.set(await Scoop.settings());
    } catch (cause) {
      error.set(String(cause));
    }
  }

  // 设置页每次打开都会重新读一遍配置文件（外部改动也能看到）。
  effect(() => {
    void loadSettings();
  });

  function flagValue(key: FlagKey): boolean {
    const value = settings();
    return value ? value[FLAG_FIELD_MAP[key]] : false;
  }

  function textValue(key: TextKey): string {
    const value = settings();
    return value ? value[TEXT_FIELD_MAP[key]] : "";
  }

  function draftOf(key: string, fallback: string): string {
    const draft = drafts()[key];
    return draft === undefined ? fallback : draft;
  }

  function setDraft(key: string, value: string) {
    drafts.set({ ...drafts(), [key]: value });
  }

  function clearDraft(key: string) {
    const next = { ...drafts() };
    delete next[key];
    drafts.set(next);
  }

  function isDirty(key: string, currentValue: string): boolean {
    const draft = drafts()[key];
    return draft !== undefined && draft !== currentValue;
  }

  function flagPatch(key: FlagKey, value: boolean): Partial<ScoopSettings> {
    return { [FLAG_FIELD_MAP[key]]: value };
  }

  async function saveFlag(key: FlagKey, checked: boolean) {
    if (savingKey()) {
      return;
    }

    const before = settings();

    if (before) {
      settings.set({ ...before, ...flagPatch(key, checked) });
    }

    savingKey.set(key);
    error.set(null);

    try {
      await Scoop.setFlag(key, checked);
    } catch (cause) {
      error.set(String(cause));

      if (before) {
        settings.set(before);
      }
    } finally {
      savingKey.set(null);
    }
  }

  /** 保存文本设置；空字符串表示恢复默认（删掉该键）。 */
  async function saveText(key: string, value: string) {
    if (savingKey()) {
      return;
    }

    savingKey.set(key);
    error.set(null);

    try {
      await Scoop.setText(key, value);
      clearDraft(key);
      await loadSettings();
    } catch (cause) {
      error.set(String(cause));
    } finally {
      savingKey.set(null);
    }
  }

  /** 导出：先选目录，确定后直接导出。 */
  async function exportConfig() {
    if (savingKey() || importing()) {
      return;
    }

    const dir = await Scoop.pickFolder();

    if (!dir) {
      return;
    }

    savingKey.set("export");
    error.set(null);

    try {
      const path = await Scoop.exportConfig(dir);
      exported.set(path);
      notify(`已导出到 ${path}`);
    } catch (cause) {
      error.set(String(cause));
    } finally {
      savingKey.set(null);
    }
  }

  async function copyExportPath() {
    const path = exported();

    if (path) {
      await Clipboard.writeText(path);
      notify("路径已复制");
    }
  }

  /** 导入：先选文件，确认后执行。 */
  async function importConfig() {
    if (importing() || isBusy()) {
      return;
    }

    const path = await Scoop.pickFile();

    if (!path) {
      return;
    }

    const ok = await confirm({
      title: "从 Scoopfile 导入？",
      description: `将使用 ${path}，安装文件里缺少的应用、添加对应 bucket。可能需要很久，期间不要关闭窗口，也不要再执行其它操作。`,
      actionLabel: "导入",
      cancelLabel: "取消",
    });

    if (!ok) {
      return;
    }

    importing.set(path);
    error.set(null);

    try {
      await Scoop.importConfig(path);
      await refreshAfterImport();
      notify("导入完成");
    } catch (cause) {
      error.set(String(cause));
    } finally {
      importing.set(null);
    }
  }

  /** 更新 Scoop 自身与所有 bucket（`scoop update`）。 */
  async function updateScoop() {
    if (updatingScoop() || isBusy()) {
      return;
    }

    updatingScoop.set(true);
    error.set(null);

    try {
      await Scoop.updateScoop();
      await loadSettings();
      notify("Scoop 与 bucket 已更新");
    } catch (cause) {
      error.set(String(cause));
    } finally {
      updatingScoop.set(false);
    }
  }

  /** 上次更新的时间，形如 `2026-11-12 16:55`。 */
  function lastUpdatedText(): string {
    const raw = settings()?.lastUpdate ?? "";

    if (!raw) {
      return "上次更新：从未";
    }

    return `上次更新：${raw.replace("T", " ").slice(0, 16)}`;
  }

  /** 清理所有应用的旧版本目录。 */
  async function cleanupOldVersions() {
    if (isBusy()) {
      return;
    }

    const ok = await confirm({
      title: "清理旧版本？",
      description:
        "删除所有应用保留的旧版本目录，只保留当前版本。已安装的应用不受影响。",
      actionLabel: "清理",
      cancelLabel: "取消",
      tone: "danger",
    });

    if (!ok) {
      return;
    }

    try {
      await Scoop.cleanupOldApps();
      notify("旧版本已清理");
    } catch (cause) {
      error.set(String(cause));
    }
  }

  async function clearCache() {
    if (isBusy()) {
      return;
    }

    const before = settings();
    const size = before ? formatBytes(before.cacheBytes) : "";

    const ok = await confirm({
      title: "清理下载缓存？",
      description: `将删除缓存里的 ${before?.cacheFiles ?? 0} 个文件（约 ${size}）。已安装的应用不受影响，只是下次重装需要重新下载。`,
      actionLabel: "清理",
      cancelLabel: "取消",
      tone: "danger",
    });

    if (!ok) {
      return;
    }

    try {
      await Scoop.clearCache();
      await loadSettings();
    } catch (cause) {
      error.set(String(cause));
    }
  }

  /** 设置里的一行：普通项左右排；宽控件在窄窗口下改成上下排。 */
  function settingRow(
    label: string,
    hint: string,
    control: any,
    stack = false,
  ) {
    return (
      <View
        class={`border-b border-border py-2.5 ${
          stack && compact()
            ? "flex-col items-stretch gap-2"
            : "flex-row items-center gap-4"
        }`}
      >
        <View class="flex-1 gap-0.5">
          <Text class="text-sm text-foreground">{label}</Text>
          <Text class="text-xs text-muted-foreground">{hint}</Text>
        </View>
        {control}
      </View>
    );
  }

  function section(title: string, children: any) {
    return (
      <Panel title={title} variant="outline" class="w-full">
        {children}
      </Panel>
    );
  }

  function flagRow(key: FlagKey, label: string, hint: string) {
    return settingRow(
      label,
      hint,
      <Switch
        testID={`flag-${key}`}
        label=""
        accessibilityLabel={label}
        checked={flagValue(key)}
        disabled={savingKey() !== null}
        onChange={(event) => void saveFlag(key, event.checked)}
      />,
    );
  }

  function textRow(
    key: TextKey,
    label: string,
    hint: string,
    placeholder: string,
  ) {
    const vertical = compact();
    return settingRow(
      label,
      hint,
      <View
        class={`flex-row flex-wrap items-center gap-2 ${
          vertical ? "w-full" : ""
        }`}
      >
        <TextField
          class={vertical ? "min-w-[220px] flex-1" : ""}
          style={vertical ? undefined : { width: FIELD_W_WIDE }}
          value={draftOf(key, textValue(key))}
          placeholder={placeholder}
          onChange={(value) => setDraft(key, value)}
        />
        <Button
          label="保存"
          variant="primary"
          disabled={!isDirty(key, textValue(key)) || savingKey() !== null}
          onPress={() => void saveText(key, draftOf(key, textValue(key)))}
        />
        <Button
          label="默认"
          variant="ghost"
          disabled={textValue(key) === "" || savingKey() !== null}
          onPress={() => void saveText(key, "")}
        />
      </View>,
      true,
    );
  }

  function selectRow(key: TextKey, label: string, hint: string, items: Option[]) {
    return settingRow(
      label,
      hint,
      <Select
        class="w-[200px]"
        items={items.map((item) => ({
          value: item.value,
          label: item.title,
        }))}
        value={textValue(key)}
        accessibilityLabel={label}
        onChange={(event) => void saveText(key, event.value)}
      />,
    );
  }

  function themeRow() {
    return settingRow(
      "主题",
      "浅色、深色，或跟随 Windows 的外观设置",
      <Select
        class="w-[200px]"
        items={[
          { value: "system", label: "跟随系统" },
          { value: "light", label: "浅色" },
          { value: "dark", label: "深色" },
        ]}
        value={themePreference()}
        accessibilityLabel="主题"
        onChange={(event) =>
          setThemePreference(event.value as ThemePreference)
        }
      />,
    );
  }

  function tokenRow() {    const vertical = compact();
    return settingRow(
      "GitHub token",
      "私有仓库、避开 GitHub API 限流用；只写入配置，不回显",
      <View
        class={`flex-row flex-wrap items-center gap-2 ${
          vertical ? "w-full" : ""
        }`}
      >
        <TextField
          class={vertical ? "min-w-[220px] flex-1" : ""}
          style={vertical ? undefined : { width: FIELD_W_WIDE }}
          value={draftOf("gh_token", "")}
          placeholder={
            settings()?.ghTokenSet ? "已设置，输入新值可覆盖" : "未设置"
          }
          onChange={(value) => setDraft("gh_token", value)}
        />
        <Button
          label="保存"
          variant="primary"
          disabled={draftOf("gh_token", "").trim() === "" || savingKey() !== null}
          onPress={() => void saveText("gh_token", draftOf("gh_token", ""))}
        />
        <If when={settings()?.ghTokenSet}>
          <Button
            label="清除"
            variant="ghost"
            disabled={savingKey() !== null}
            onPress={() => void saveText("gh_token", "")}
          />
        </If>
      </View>,
      true,
    );
  }

  function infoRow(label: string, value: () => string) {
    return (
      <View class="flex-row items-center gap-4 border-b border-border py-2.5">
        <Text class="w-32 text-sm text-foreground">{label}</Text>
        <Text
          class="flex-1 text-xs text-muted-foreground"
          style={{ numberOfLines: 1 }}
        >
          {value()}
        </Text>
      </View>
    );
  }

  return (
    <Scroll class="flex-1" contentStyle={{ padding: 16 }}>
      <If when={settings() == null}>
        <Text class="py-6 text-center text-sm text-muted-foreground">
          正在读取 Scoop 设置…
        </Text>
      </If>
      <View class="gap-3">
        {section(
          "外观",
          <View>
            {themeRow()}
          </View>,
        )}

        {section(
          "下载",
          <View>
            {flagRow(
              "aria2-enabled",
              "aria2 加速",
              "用 aria2 多线程下载，大文件更快（需要已安装 aria2）",
            )}
            {flagRow(
              "aria2-fallback-enabled",
              "aria2 失败回退",
              "aria2 出错时自动改用内置下载器，而不是直接报错",
            )}
            {textRow(
              "proxy",
              "代理",
              "default / none / currentuser / host:port；留空用系统代理",
              "default",
            )}
            {textRow(
              "github_proxy",
              "GitHub 下载代理",
              "例如 https://ghproxy.net/；只加速 GitHub 的清单和预下载，留空直连",
              "https://ghproxy.net/",
            )}
          </View>,
        )}

        {section(
          "安装",
          <View>
            {selectRow(
              "default_architecture",
              "默认架构",
              "安装时优先选择的架构；跟随系统则用计算机本身的",
              [
                { value: "", title: "跟随系统" },
                { value: "64bit", title: "64bit" },
                { value: "32bit", title: "32bit" },
                { value: "arm64", title: "arm64" },
              ],
            )}
            {selectRow(
              "shim",
              "shim 实现",
              "命令包装器的实现；换掉后已建的 shim 需要重建才生效",
              [
                { value: "kiennq", title: "kiennq" },
                { value: "scoopcs", title: "scoopcs" },
                { value: "71", title: "7zip 版" },
              ],
            )}
            {flagRow(
              "use_external_7zip",
              "外部 7-Zip",
              "用系统已装的 7z.exe 解压，比内置解压更快",
            )}
            {flagRow(
              "use_lessmsi",
              "lessmsi",
              "用 lessmsi 解 msi，便于取出安装包里的文件",
            )}
            {flagRow(
              "no_junction",
              "不使用 current 链接",
              "让 shim 和快捷方式直接指向具体版本目录；只影响之后安装的应用",
            )}
            {flagRow(
              "ignore_running_processes",
              "忽略运行中的进程",
              "升级或卸载时即使目标应用正在运行也继续（默认会中止）",
            )}
          </View>,
        )}

        {section(
          "更新",
          <View>
            <View class="flex-row items-center gap-4 border-b border-border py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">更新 Scoop 和 bucket</Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {lastUpdatedText()}
                </Text>
              </View>
              <Button
                label={updatingScoop() ? "更新中…" : "立即更新"}
                icon="download"
                disabled={isBusy() || updatingScoop()}
                onPress={() => void updateScoop()}
              />
            </View>
            {textRow(
              "scoop_repo",
              "Scoop 仓库",
              "Scoop 自身的源码仓库，可换成镜像地址",
              "https://github.com/ScoopInstaller/Scoop",
            )}
            {selectRow(
              "scoop_branch",
              "Scoop 分支",
              "master 稳定版；develop 提前拿到新功能",
              [
                { value: "master", title: "master" },
                { value: "develop", title: "develop" },
              ],
            )}
            {flagRow(
              "update_nightly",
              "更新 nightly",
              "允许 nightly 版本在一天后被更新",
            )}
            {flagRow(
              "force_update",
              "强制更新",
              "即使版本号相同，也按 bucket 里的清单重装",
            )}
            {flagRow(
              "use_git_history",
              "查 git 历史",
              "安装带版本号的旧版本时，先在 bucket 的 git 历史里找清单",
            )}
            {flagRow(
              "autostash_on_conflict",
              "冲突时自动 stash",
              "更新 bucket 遇到本地改动时自动暂存，而不是直接中止",
            )}
            {tokenRow()}
          </View>,
        )}

        {section(
          "高级",
          <View>
            {flagRow(
              "debug",
              "调试输出",
              "让 Scoop 打印更详细的日志，排查失败原因时有用",
            )}
          </View>,
        )}

        {section(
          "备份",
          <View>
            <View class="flex-row items-center gap-4 border-b border-border py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">导出到文件</Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {exported() ?? "点击导出后选择目录，保存成 Scoopfile"}
                </Text>
              </View>
              <If when={exported()}>
                <Button
                  label="复制路径"
                  size="small"
                  variant="ghost"
                  onPress={() => void copyExportPath()}
                />
              </If>
              <Button
                label="导出"
                variant="primary"
                icon="upload"
                disabled={savingKey() !== null || importing() !== null}
                onPress={() => void exportConfig()}
              />
            </View>
            <View class="flex-row items-center gap-4 py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">从文件导入</Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  点击导入后选择 Scoopfile，安装缺失的应用、添加 bucket
                </Text>
              </View>
              <Button
                label={importing() !== null ? "导入中…" : "导入"}
                icon="download"
                disabled={importing() !== null || isBusy()}
                onPress={() => void importConfig()}
              />
            </View>
          </View>,
        )}

        {section(
          "缓存",
          <View>
            <View class="flex-row items-center gap-4 py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">
                  {`${formatBytes(settings()?.cacheBytes ?? 0)} · ${settings()?.cacheFiles ?? 0} 个文件`}
                </Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {settings()?.cachePath ?? ""}
                </Text>
              </View>
              <Button
                label="清理旧版本"
                size="small"
                disabled={isBusy()}
                onPress={() => void cleanupOldVersions()}
              />
              <Button
                label="清理缓存"
                size="small"
                disabled={isBusy() || (settings()?.cacheFiles ?? 0) === 0}
                onPress={() => void clearCache()}
              />
            </View>
          </View>,
        )}

        {section(
          "关于",
          <View>
            {infoRow(
              "ScoopDeck 版本",
              () =>
                `${app.version ?? "—"}${app.development ? "（开发版）" : ""}`,
            )}
            {infoRow("Scoop 版本", () => settings()?.version ?? "")}
            {infoRow("根目录", () => settings()?.rootPath ?? "")}
            {infoRow("全局目录", () => settings()?.globalPath ?? "")}
            {infoRow("配置文件", () => "~/.config/scoop/config.json")}
          </View>,
        )}
      </View>
    </Scroll>
  );
}
