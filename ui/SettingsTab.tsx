import { appInfo, Clipboard, effect, Scroll, signal, Text, View } from "nsh";
import { Button, Panel, Select, Switch } from "./omarchy";
import { confirm } from "./confirm";
import { Scoop, type ScoopSettings } from "scoop-deck/native";
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from "./theme";
import {
  languagePreference,
  setLanguagePreference,
  t,
  type LanguagePreference,
} from "./i18n";
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
      notify(t("settings.notify.exported", { path }));
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
      notify(t("settings.notify.pathCopied"));
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
      title: t("settings.importConfirmTitle"),
      description: t("settings.importConfirmDesc", { path }),
      actionLabel: t("settings.import"),
      cancelLabel: t("common.cancel"),
    });

    if (!ok) {
      return;
    }

    importing.set(path);
    error.set(null);

    try {
      await Scoop.importConfig(path);
      await refreshAfterImport();
      notify(t("settings.notify.imported"));
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
      notify(t("settings.notify.updated"));
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
      return t("settings.lastUpdatedNever");
    }

    return t("settings.lastUpdated", {
      time: raw.replace("T", " ").slice(0, 16),
    });
  }

  /** 清理所有应用的旧版本目录。 */
  async function cleanupOldVersions() {
    if (isBusy()) {
      return;
    }

    const ok = await confirm({
      title: t("settings.cleanupTitle"),
      description: t("settings.cleanupDesc"),
      actionLabel: t("settings.cleanup"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });

    if (!ok) {
      return;
    }

    try {
      await Scoop.cleanupOldApps();
      notify(t("settings.notify.cleaned"));
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
      title: t("settings.clearCacheTitle"),
      description: t("settings.clearCacheDesc", {
        count: before?.cacheFiles ?? 0,
        size,
      }),
      actionLabel: t("settings.cleanup"),
      cancelLabel: t("common.cancel"),
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
          label={t("common.save")}
          variant="primary"
          disabled={!isDirty(key, textValue(key)) || savingKey() !== null}
          onPress={() => void saveText(key, draftOf(key, textValue(key)))}
        />
        <Button
          label={t("common.default")}
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

  function languageRow() {
    return settingRow(
      t("settings.language"),
      t("settings.languageHint"),
      <Select
        class="w-[200px]"
        items={[
          { value: "system", label: t("settings.languageSystem") },
          { value: "zh-CN", label: t("settings.languageZh") },
          { value: "en", label: t("settings.languageEn") },
        ]}
        value={languagePreference()}
        accessibilityLabel={t("settings.language")}
        onChange={(event) =>
          setLanguagePreference(event.value as LanguagePreference)
        }
      />,
    );
  }

  function themeRow() {
    return settingRow(
      t("settings.theme"),
      t("settings.themeHint"),
      <Select
        class="w-[200px]"
        items={[
          { value: "system", label: t("settings.themeSystem") },
          { value: "light", label: t("settings.themeLight") },
          { value: "dark", label: t("settings.themeDark") },
        ]}
        value={themePreference()}
        accessibilityLabel={t("settings.theme")}
        onChange={(event) =>
          setThemePreference(event.value as ThemePreference)
        }
      />,
    );
  }

  function tokenRow() {
    const vertical = compact();
    return settingRow(
      t("settings.token"),
      t("settings.tokenHint"),
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
            settings()?.ghTokenSet
              ? t("settings.tokenSet")
              : t("settings.tokenUnset")
          }
          onChange={(value) => setDraft("gh_token", value)}
        />
        <Button
          label={t("common.save")}
          variant="primary"
          disabled={draftOf("gh_token", "").trim() === "" || savingKey() !== null}
          onPress={() => void saveText("gh_token", draftOf("gh_token", ""))}
        />
        <If when={settings()?.ghTokenSet}>
          <Button
            label={t("common.clear")}
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
          {t("settings.loading")}
        </Text>
      </If>
      <View class="gap-3">
        {section(
          t("settings.section.appearance"),
          <View>
            {themeRow()}
            {languageRow()}
          </View>,
        )}

        {section(
          t("settings.section.download"),
          <View>
            {flagRow(
              "aria2-enabled",
              t("settings.aria2"),
              t("settings.aria2Hint"),
            )}
            {flagRow(
              "aria2-fallback-enabled",
              t("settings.aria2Fallback"),
              t("settings.aria2FallbackHint"),
            )}
            {textRow(
              "proxy",
              t("settings.proxy"),
              t("settings.proxyHint"),
              t("settings.proxyPlaceholder"),
            )}
            {textRow(
              "github_proxy",
              t("settings.githubProxy"),
              t("settings.githubProxyHint"),
              "https://ghproxy.net/",
            )}
          </View>,
        )}

        {section(
          t("settings.section.install"),
          <View>
            {selectRow(
              "default_architecture",
              t("settings.defaultArch"),
              t("settings.defaultArchHint"),
              [
                { value: "", title: t("settings.defaultArchSystem") },
                { value: "64bit", title: "64bit" },
                { value: "32bit", title: "32bit" },
                { value: "arm64", title: "arm64" },
              ],
            )}
            {selectRow(
              "shim",
              t("settings.shim"),
              t("settings.shimHint"),
              [
                { value: "kiennq", title: "kiennq" },
                { value: "scoopcs", title: "scoopcs" },
                { value: "71", title: t("settings.shim7zip") },
              ],
            )}
            {flagRow(
              "use_external_7zip",
              t("settings.external7zip"),
              t("settings.external7zipHint"),
            )}
            {flagRow(
              "use_lessmsi",
              t("settings.lessmsi"),
              t("settings.lessmsiHint"),
            )}
            {flagRow(
              "no_junction",
              t("settings.noJunction"),
              t("settings.noJunctionHint"),
            )}
            {flagRow(
              "ignore_running_processes",
              t("settings.ignoreRunning"),
              t("settings.ignoreRunningHint"),
            )}
          </View>,
        )}

        {section(
          t("settings.section.update"),
          <View>
            <View class="flex-row items-center gap-4 border-b border-border py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">{t("settings.updateScoop")}</Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {lastUpdatedText()}
                </Text>
              </View>
              <Button
                label={
                  updatingScoop()
                    ? t("settings.updating")
                    : t("settings.updateNow")
                }
                icon="download"
                disabled={isBusy() || updatingScoop()}
                onPress={() => void updateScoop()}
              />
            </View>
            {textRow(
              "scoop_repo",
              t("settings.repo"),
              t("settings.repoHint"),
              "https://github.com/ScoopInstaller/Scoop",
            )}
            {selectRow(
              "scoop_branch",
              t("settings.branch"),
              t("settings.branchHint"),
              [
                { value: "master", title: "master" },
                { value: "develop", title: "develop" },
              ],
            )}
            {flagRow(
              "update_nightly",
              t("settings.nightly"),
              t("settings.nightlyHint"),
            )}
            {flagRow(
              "force_update",
              t("settings.forceUpdate"),
              t("settings.forceUpdateHint"),
            )}
            {flagRow(
              "use_git_history",
              t("settings.gitHistory"),
              t("settings.gitHistoryHint"),
            )}
            {flagRow(
              "autostash_on_conflict",
              t("settings.autostash"),
              t("settings.autostashHint"),
            )}
            {tokenRow()}
          </View>,
        )}

        {section(
          t("settings.section.advanced"),
          <View>
            {flagRow(
              "debug",
              t("settings.debug"),
              t("settings.debugHint"),
            )}
          </View>,
        )}

        {section(
          t("settings.section.backup"),
          <View>
            <View class="flex-row items-center gap-4 border-b border-border py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">{t("settings.exportTitle")}</Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {exported() ?? t("settings.exportHint")}
                </Text>
              </View>
              <If when={exported()}>
                <Button
                  label={t("settings.copyPath")}
                  size="small"
                  variant="ghost"
                  onPress={() => void copyExportPath()}
                />
              </If>
              <Button
                label={t("settings.export")}
                variant="primary"
                icon="upload"
                disabled={savingKey() !== null || importing() !== null}
                onPress={() => void exportConfig()}
              />
            </View>
            <View class="flex-row items-center gap-4 py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">{t("settings.importTitle")}</Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {t("settings.importHint")}
                </Text>
              </View>
              <Button
                label={
                  importing() !== null
                    ? t("settings.importing")
                    : t("settings.import")
                }
                icon="download"
                disabled={importing() !== null || isBusy()}
                onPress={() => void importConfig()}
              />
            </View>
          </View>,
        )}

        {section(
          t("settings.section.cache"),
          <View>
            <View class="flex-row items-center gap-4 py-2.5">
              <View class="flex-1 gap-0.5">
                <Text class="text-sm text-foreground">
                  {t("settings.cacheSummary", {
                    size: formatBytes(settings()?.cacheBytes ?? 0),
                    count: settings()?.cacheFiles ?? 0,
                  })}
                </Text>
                <Text
                  class="text-xs text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                >
                  {settings()?.cachePath ?? ""}
                </Text>
              </View>
              <Button
                label={t("settings.cleanupOld")}
                size="small"
                disabled={isBusy()}
                onPress={() => void cleanupOldVersions()}
              />
              <Button
                label={t("settings.clearCache")}
                size="small"
                disabled={isBusy() || (settings()?.cacheFiles ?? 0) === 0}
                onPress={() => void clearCache()}
              />
            </View>
          </View>,
        )}

        {section(
          t("settings.section.about"),
          <View>
            {infoRow(
              t("settings.appVersion"),
              () =>
                `${app.version ?? "—"}${
                  app.development ? t("settings.devVersion") : ""
                }`,
            )}
            {infoRow(t("settings.scoopVersion"), () => settings()?.version ?? "")}
            {infoRow(t("settings.root"), () => settings()?.rootPath ?? "")}
            {infoRow(t("settings.global"), () => settings()?.globalPath ?? "")}
            {infoRow(t("settings.config"), () => "~/.config/scoop/config.json")}
          </View>,
        )}
      </View>
    </Scroll>
  );
}
