import { signal, Scroll, Text, View } from "nsh";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "nsh/base";
import type { ScoopCatalogApp } from "scoop-deck/native";
import { Button, Dialog, EmptyState } from "./omarchy";
import {
  CELL,
  FIELD_W,
  FIELD_W_WIDE,
  HEAD,
  SURFACE,
  TextField,
  useCompact,
} from "./ui";
import { JobSlot, PreparingButton } from "./JobSlot";
import { HintTooltip } from "./tooltip";
import { isManifestUrl, TAB_BUCKETS, useDeck } from "./deck";
import { t } from "./i18n";

export function SearchTab() {
  const {
    tab,
    query,
    hint,
    loadingCatalog,
    catalog,
    matched,
    shown,
    installApp,
    installFromUrl,
    jobOf,
    preparing,
    installedNames,
    openDetails,
  } = useDeck();
  const compact = useCompact();
  const urlOpen = signal(false);
  const urlDraft = signal("");
  const urlError = signal<string | null>(null);

  function openUrlDialog() {
    urlDraft.set("");
    urlError.set(null);
    urlOpen.set(true);
  }

  function submitUrl() {
    const url = urlDraft().trim();

    if (!isManifestUrl(url)) {
      urlError.set(t("search.urlInvalid"));
      return;
    }

    urlOpen.set(false);
    urlDraft.set("");
    urlError.set(null);
    installFromUrl(url);
  }

  /** 表格行和窄屏卡片共用同一组操作。 */
  function rowActions(app: ScoopCatalogApp) {
    return (
      <View class="flex-row flex-wrap items-center gap-1">
        <JobSlot name={app.name} kind="install" />
        <If when={!jobOf(app.name, "install")}>
          <If when={preparing().includes(app.name)}>
            <PreparingButton />
          </If>
          <If when={!preparing().includes(app.name)}>
            <If when={installedNames().has(app.name)}>
              <Text class="text-xs text-muted-foreground">
                {t("search.installed")}
              </Text>
            </If>
            <If when={!installedNames().has(app.name)}>
              <Button
                label={t("common.install")}
                variant="primary"
                size="small"
                onPress={() => void installApp(app)}
              />
            </If>
          </If>
        </If>
      </View>
    );
  }

  return (
    <View class="flex-1">
      <View class="flex-row flex-wrap items-center gap-3 border-b border-border bg-background px-5 py-3">
        <TextField
          testID="search-input"
          style={{ width: FIELD_W }}
          value={query()}
          placeholder={t("search.placeholder")}
          clearLabel={t("search.clear")}
          onClear={() => query.set("")}
          onChange={(value) => query.set(value)}
        />
        <Text class="text-sm text-muted-foreground">{hint()}</Text>
        <Button
          class="ml-auto"
          label={t("search.installFromUrl")}
          icon="link"
          size="small"
          variant="ghost"
          onPress={openUrlDialog}
        />
      </View>
      <If when={query().trim() === ""}>
        <View class="flex-1 items-center justify-center gap-2 px-6">
          <EmptyState
            title={
              loadingCatalog()
                ? t("search.loading")
                : t("search.catalogCount", { count: catalog().length })
            }
            description={
              !loadingCatalog() && catalog().length === 0
                ? t("search.noBuckets")
                : t("search.startTyping")
            }
            icon="search"
          >
            <If when={!loadingCatalog() && catalog().length === 0}>
              <Button
                label={t("search.goBuckets")}
                variant="primary"
                icon="folder"
                onPress={() => tab.set(TAB_BUCKETS)}
              />
            </If>
          </EmptyState>
        </View>
      </If>
      <If when={query().trim() !== ""}>
        <Scroll class="flex-1" contentStyle={{ padding: 16 }}>
          <If when={!compact()}>
            <View class={SURFACE}>
              <Table accessibilityLabel={t("search.table")}>
                <TableHeader>
                  <TableRow class="flex-row items-center gap-3 border-b border-border bg-muted px-3 py-2">
                    <TableHead class="flex-1"><Text class={HEAD}>{t("common.name")}</Text></TableHead>
                    <TableHead class="flex-1"><Text class={HEAD}>{t("common.version")}</Text></TableHead>
                    <TableHead class="flex-1"><Text class={HEAD}>{t("common.bucket")}</Text></TableHead>
                    <TableHead style={{ flex: 2 }}><Text class={HEAD}>{t("common.description")}</Text></TableHead>
                    <TableHead class="flex-1"><Text class={HEAD}>{t("common.actions")}</Text></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <Each of={shown()} key={(entry) => `${entry.bucket}/${entry.name}`}>
                    {(item) => (
                      <TableRow class="flex-row items-center gap-3 border-b border-border px-3 py-2 hover:bg-accent active:bg-accent">
                        <TableCell class="flex-1">
                          <View
                            class="active:opacity-60"
                            accessibilityLabel={t("installed.viewDetails", {
                              name: item().name,
                            })}
                            onPress={() => void openDetails(item().name)}
                          >
                            <Text
                              class="text-sm font-semibold text-foreground"
                              style={{ numberOfLines: 1 }}
                            >
                              {item().name}
                            </Text>
                          </View>
                        </TableCell>
                        <TableCell class="flex-1">
                          <Text class={CELL} style={{ numberOfLines: 1 }}>
                            {item().version}
                          </Text>
                        </TableCell>
                        <TableCell class="flex-1">
                          <Text class={CELL} style={{ numberOfLines: 1 }}>
                            {item().bucket}
                          </Text>
                        </TableCell>
                        <TableCell
                          style={{ flex: 2 }}
                          tooltip={<HintTooltip label={item().description} />}
                        >
                          <Text class={CELL} style={{ numberOfLines: 1 }}>
                            {item().description}
                          </Text>
                        </TableCell>
                        <TableCell class="flex-1">
                          {rowActions(item())}
                        </TableCell>
                      </TableRow>
                    )}
                  </Each>
                </TableBody>
              </Table>
            </View>
          </If>
          <If when={compact()}>
            <View class="gap-2">
              <Each of={shown()} key={(entry) => `${entry.bucket}/${entry.name}`}>
                {(item) => (
                  <View class="gap-2 rounded-(--radius) border border-border bg-background p-3">
                    <View class="flex-row items-start gap-2">
                      <View
                        class="flex-1 active:opacity-60"
                        accessibilityLabel={t("installed.viewDetails", {
                          name: item().name,
                        })}
                        onPress={() => void openDetails(item().name)}
                      >
                        <Text
                          class="text-sm font-semibold text-foreground"
                          style={{ numberOfLines: 1 }}
                        >
                          {item().name}
                        </Text>
                      </View>
                      <Text class="shrink-0 text-xs text-muted-foreground">
                        {item().bucket}
                      </Text>
                    </View>
                    <View class="flex-row items-center gap-2">
                      <Text class="text-xs text-muted-foreground">{t("common.version")}</Text>
                      <Text class={CELL}>{item().version}</Text>
                    </View>
                    <If when={item().description !== ""}>
                      <Text
                        class="text-xs text-muted-foreground"
                        style={{ numberOfLines: 2 }}
                      >
                        {item().description}
                      </Text>
                    </If>
                    {rowActions(item())}
                  </View>
                )}
              </Each>
            </View>
          </If>
          <If when={loadingCatalog()}>
            <Text class="py-8 text-center text-sm text-muted-foreground">
              {t("search.loading")}
            </Text>
          </If>
          <If when={!loadingCatalog() && matched().length === 0}>
            <EmptyState
              title={t("search.noMatch")}
              description={t("search.noMatchHint")}
              icon="search"
            />
          </If>
          <If when={!loadingCatalog() && catalog().length === 0}>
            <EmptyState
              title={t("search.noCatalog")}
              description={t("search.noCatalogHint")}
              icon="folder"
            />
          </If>
        </Scroll>
      </If>

      <If when={urlOpen()}>
        <Dialog
          title={t("search.urlTitle")}
          description={t("search.urlDesc")}
          open={urlOpen()}
        // 和确认框一致：点背景不关闭，Escape / 按钮才关。
        closeOnBackdropPress={false}
        onOpenChange={(event) => {
          if (!event.open) {
            urlOpen.set(false);
            urlError.set(null);
          }
        }}
        footer={
          <View class="flex-row justify-end gap-2">
            <Button
              label={t("common.install")}
              variant="primary"
              disabled={urlDraft().trim() === ""}
              onPress={submitUrl}
            />
            <Button
              label={t("common.cancel")}
              onPress={() => {
                urlOpen.set(false);
                urlError.set(null);
              }}
            />
          </View>
        }
      >
        <View class="gap-2">
          <TextField
            testID="url-input"
            style={{ width: FIELD_W_WIDE }}
            value={urlDraft()}
            placeholder={t("search.urlPlaceholder")}
            accessibilityLabel={t("search.urlField")}
            onChange={(value) => {
              urlDraft.set(value);
              urlError.set(null);
            }}
          />
          <If when={urlError()}>
            <Text class="text-xs text-destructive">{urlError()}</Text>
          </If>
        </View>
        </Dialog>
      </If>
    </View>
  );
}
