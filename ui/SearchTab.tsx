import { Scroll, Text, View } from "nsh";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "nsh/base";
import type { ScoopCatalogApp } from "scoop-deck/native";
import { Button, EmptyState, Tooltip } from "./omarchy";
import {
  CELL,
  FIELD_W,
  HEAD,
  SURFACE,
  TextField,
  useCompact,
} from "./ui";
import { JobSlot, PreparingButton } from "./JobSlot";
import { TAB_BUCKETS, useDeck } from "./deck";

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
    jobOf,
    preparing,
    installedNames,
    openDetails,
  } = useDeck();
  const compact = useCompact();

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
                ✓ 已安装
              </Text>
            </If>
            <If when={!installedNames().has(app.name)}>
              <Button
                label="安装"
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
          placeholder="输入包名或描述关键词"
          clearLabel="清空搜索"
          onClear={() => query.set("")}
          onChange={(value) => query.set(value)}
        />
        <Text class="text-sm text-muted-foreground">{hint()}</Text>
      </View>
      <If when={query().trim() === ""}>
        <View class="flex-1 items-center justify-center gap-2 px-6">
          <EmptyState
            title={
              loadingCatalog()
                ? "正在加载清单…"
                : `${catalog().length} 个可安装包`
            }
            description={
              !loadingCatalog() && catalog().length === 0
                ? "还没有添加 bucket，先添加一个清单来源"
                : "输入关键词开始搜索"
            }
            icon="search"
          >
            <If when={!loadingCatalog() && catalog().length === 0}>
              <Button
                label="去添加 Bucket"
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
              <Table accessibilityLabel="可安装的包">
                <TableHeader>
                  <TableRow class="flex-row items-center gap-3 border-b border-border bg-muted px-3 py-2">
                    <TableHead class="flex-1"><Text class={HEAD}>名称</Text></TableHead>
                    <TableHead class="flex-1"><Text class={HEAD}>版本</Text></TableHead>
                    <TableHead class="flex-1"><Text class={HEAD}>bucket</Text></TableHead>
                    <TableHead style={{ flex: 2 }}><Text class={HEAD}>描述</Text></TableHead>
                    <TableHead class="flex-1"><Text class={HEAD}>操作</Text></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <Each of={shown()} key={(entry) => `${entry.bucket}/${entry.name}`}>
                    {(item) => (
                      <TableRow class="flex-row items-center gap-3 border-b border-border px-3 py-2 hover:bg-accent active:bg-accent">
                        <TableCell class="flex-1">
                          <View
                            class="active:opacity-60"
                            accessibilityLabel={`查看 ${item().name} 的详情`}
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
                          tooltip={<Tooltip label={item().description} />}
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
                        accessibilityLabel={`查看 ${item().name} 的详情`}
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
                      <Text class="text-xs text-muted-foreground">版本</Text>
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
              正在加载清单…
            </Text>
          </If>
          <If when={!loadingCatalog() && matched().length === 0}>
            <EmptyState
              title="没有匹配的包"
              description="试试更短的关键词，或先添加对应的 bucket。"
              icon="search"
            />
          </If>
          <If when={!loadingCatalog() && catalog().length === 0}>
            <EmptyState
              title="还没有可安装的包"
              description="先到「Bucket」页添加一个 bucket。"
              icon="folder"
            />
          </If>
        </Scroll>
      </If>
    </View>
  );
}
