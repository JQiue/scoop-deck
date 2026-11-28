import { Scroll, Text, View } from "nsh";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "nsh/base";
import type { ScoopApp } from "scoop-deck/native";
import {
  Button,
  EmptyState,
  IconButton,
  Popover,
  Toggle,
  Tooltip,
} from "./omarchy";
import {
  CARD,
  CELL,
  FIELD_W,
  HEAD,
  SURFACE,
  TextField,
  useCompact,
} from "./ui";
import { JobSlot, PreparingButton } from "./JobSlot";
import { TAB_SEARCH, useDeck } from "./deck";
import { InstalledStatus, isUrlSource } from "./types";
import { t } from "./i18n";

export function InstalledTab() {
  const {
    tab,
    apps,
    loadingApps,
    updatable,
    filtersActive,
    activeFilterCount,
    statusOptions,
    bucketOptions,
    installedQuery,
    installedStatus,
    bucketFilter,
    visibleUpdatable,
    updateAll,
    listedApps,
    recentlyDone,
    openDetails,
    hasUpdate,
    jobOf,
    preparing,
    uninstallApp,
    updateApp,
    emptyText,
  } = useDeck();
  const compact = useCompact();

  /** URL 清单安装时，来源列显示域名而不是完整地址。 */
  function sourceLabel(app: ScoopApp): string {
    const source = app.bucket.trim();

    if (isUrlSource(source)) {
      return source.replace(/^https?:\/\//i, "").split("/")[0] || "URL";
    }

    return source || "—";
  }

  /** 表格行和窄屏卡片共用同一组操作。 */
  function rowActions(app: ScoopApp) {
    return (
      <View class="flex-row flex-wrap items-center gap-1">
        <JobSlot name={app.name} kind="update" />
        <If when={!jobOf(app.name, "update")}>
          <If when={preparing().includes(app.name)}>
            <PreparingButton />
          </If>
          <If when={!preparing().includes(app.name)}>
            <If when={hasUpdate(app)}>
              <IconButton
                icon="arrow-up"
                label={t("common.update")}
                size="small"
                variant="default"
                onPress={() => void updateApp(app)}
              />
            </If>
          </If>
        </If>
        <JobSlot name={app.name} kind="uninstall" />
        <If when={!jobOf(app.name, "uninstall")}>
          <IconButton
            icon="trash"
            label={t("common.uninstall")}
            size="small"
            variant="danger"
            onPress={() => void uninstallApp(app.name)}
          />
        </If>
      </View>
    );
  }

  return (
    <View class="flex-1">
      <If when={apps().length > 0}>
        <View class="flex-row flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-5 py-3">
          <View class="flex-row flex-wrap items-center gap-2">
            <TextField
              style={{ width: FIELD_W }}
              value={installedQuery()}
              placeholder={t("installed.filterPlaceholder")}
              onClear={() => installedQuery.set("")}
              onChange={(value) => installedQuery.set(value)}
            />
            <Popover
              placement="bottom"
              align="start"
              title={t("common.filter")}
              trigger={
                <Button
                  label={
                    filtersActive()
                      ? t("installed.filterActive", {
                          count: activeFilterCount(),
                        })
                      : t("common.filter")
                  }
                  variant={filtersActive() ? "primary" : "default"}
                  icon="funnel"
                />
              }
            >
              <View class="gap-3">
                <View class="gap-1.5">
                  <Text class={HEAD}>{t("installed.status")}</Text>
                  <View class="flex-row flex-wrap gap-1">
                    <Each of={statusOptions()} key={(option) => option.value}>
                      {(option) => (
                        <Toggle
                          label={option().title}
                          size="small"
                          checked={installedStatus() === option().value}
                          onChange={() =>
                            installedStatus.set(
                              option().value as InstalledStatus,
                            )
                          }
                        />
                      )}
                    </Each>
                  </View>
                </View>
                <View class="gap-1.5">
                  <Text class={HEAD}>{t("installed.source")}</Text>
                  <View class="flex-row flex-wrap gap-1">
                    <Each of={bucketOptions()} key={(option) => option.value}>
                      {(option) => (
                        <Toggle
                          label={option().title}
                          size="small"
                          checked={bucketFilter() === option().value}
                          onChange={() => bucketFilter.set(option().value)}
                        />
                      )}
                    </Each>
                  </View>
                </View>
              </View>
            </Popover>
          </View>
          <If when={visibleUpdatable().length > 0}>
            <Button
              label={
                filtersActive()
                  ? t("installed.updateFiltered", {
                      count: visibleUpdatable().length,
                    })
                  : t("installed.updateAll", { count: updatable().length })
              }
              variant="primary"
              icon="arrow-up"
              onPress={() => void updateAll(visibleUpdatable())}
            />
          </If>
        </View>
      </If>
      <Scroll class="flex-1" contentStyle={{ padding: 16 }}>
        <If when={!compact()}>
          <View class={SURFACE}>
            <Table accessibilityLabel={t("installed.table")}>
              <TableHeader>
                <TableRow class="flex-row items-center gap-3 border-b border-border bg-muted px-3 py-2">
                  <TableHead class="flex-1"><Text class={HEAD}>{t("common.name")}</Text></TableHead>
                  <TableHead style={{ flex: 1.3 }}><Text class={HEAD}>{t("common.version")}</Text></TableHead>
                  <TableHead class="flex-1"><Text class={HEAD}>{t("installed.source")}</Text></TableHead>
                  <TableHead style={{ flex: 2 }}><Text class={HEAD}>{t("common.description")}</Text></TableHead>
                  <TableHead class="flex-1"><Text class={HEAD}>{t("common.actions")}</Text></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <Each of={listedApps()} key={(app) => app.name}>
                  {(item) => (
                    <TableRow
                      class={`flex-row items-center gap-3 border-b border-border px-3 py-2 hover:bg-accent active:bg-accent ${recentlyDone() === item().name ? "bg-primary/10" : ""
                        }`}
                    >
                      <TableCell class="flex-1">
                        <View
                          class="active:opacity-60"
                          accessibilityLabel={t("installed.viewDetails", {
                            name: item().name,
                          })}
                          tooltip={
                            <Tooltip label={t("installed.clickDetails")} />
                          }
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
                      <TableCell style={{ flex: 1.3 }} class="overflow-hidden">
                        <View class="flex-row items-center gap-1 overflow-hidden">
                          <Text class={CELL} style={{ numberOfLines: 1 }}>
                            {item().installedVersion}
                          </Text>
                          <If when={hasUpdate(item())}>
                            <Text class="text-sm text-muted-foreground">→</Text>
                            <Text
                              class="text-sm text-primary"
                              style={{ numberOfLines: 1 }}
                            >
                              {item().latestVersion}
                            </Text>
                          </If>
                        </View>
                      </TableCell>
                      <TableCell class="flex-1">
                        <If when={isUrlSource(item().bucket)}>
                          <View
                            tooltip={<Tooltip label={item().bucket} />}
                          >
                            <Text class={CELL} style={{ numberOfLines: 1 }}>
                              {sourceLabel(item())}
                            </Text>
                          </View>
                        </If>
                        <If when={!isUrlSource(item().bucket)}>
                          <Text class={CELL} style={{ numberOfLines: 1 }}>
                            {sourceLabel(item())}
                          </Text>
                        </If>
                      </TableCell>
                      <TableCell
                        style={{ flex: 2 }}
                        tooltip={
                          <Tooltip label={item().description} />
                        }
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
            <Each of={listedApps()} key={(app) => app.name}>
              {(item) => (
                <View
                  class={`gap-2 ${CARD} p-3 ${recentlyDone() === item().name ? "bg-primary/10" : ""
                    }`}
                >
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
                    <If when={isUrlSource(item().bucket)}>
                      <View
                        class="shrink-0"
                        tooltip={<Tooltip label={item().bucket} />}
                      >
                        <Text
                          class="text-xs text-muted-foreground"
                          style={{ numberOfLines: 1 }}
                        >
                          {sourceLabel(item())}
                        </Text>
                      </View>
                    </If>
                    <If when={!isUrlSource(item().bucket)}>
                      <Text
                        class="shrink-0 text-xs text-muted-foreground"
                        style={{ numberOfLines: 1 }}
                      >
                        {sourceLabel(item())}
                      </Text>
                    </If>
                  </View>
                  <View class="flex-row flex-wrap items-center gap-2">
                    <Text class="text-xs text-muted-foreground">{t("common.version")}</Text>
                    <Text class={CELL}>{item().installedVersion}</Text>
                    <If when={hasUpdate(item())}>
                      <Text class="text-sm text-muted-foreground">→</Text>
                      <Text class="text-sm text-primary">
                        {item().latestVersion}
                      </Text>
                    </If>
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
        <If when={loadingApps() && apps().length === 0}>
          <Text class="py-8 text-center text-sm text-muted-foreground">
            {t("installed.loading")}
          </Text>
        </If>
        <If when={!loadingApps() && listedApps().length === 0}>
          <EmptyState
            title={emptyText()}
            description={
              apps().length === 0 ? t("installed.emptyHint") : null
            }
            icon="inbox"
          >
            <If when={apps().length === 0}>
              <Button
                label={t("installed.goSearch")}
                variant="primary"
                icon="search"
                onPress={() => tab.set(TAB_SEARCH)}
              />
            </If>
          </EmptyState>
        </If>
      </Scroll>
    </View>
  );
}
