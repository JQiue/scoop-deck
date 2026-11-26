import { Text, View } from "nsh";
import { Button, IconButton, Link, Sheet, Tooltip } from "./omarchy";
import { CELL, formatBytes } from "./ui";
import { useDeck } from "./deck";
import { isUrlSource } from "./types";

function detailRow(label: string, value: string) {
  return (
    <View class="flex-row items-start gap-3 border-b border-border py-1.5">
      <Text class="w-20 text-xs text-muted-foreground">{label}</Text>
      <Text class="flex-1 text-sm text-foreground">{value}</Text>
    </View>
  );
}

/** 和其他信息同排，但值是可点击的链接。 */
function detailLinkRow(label: string, href: string) {
  return (
    <View class="flex-row items-start gap-3 border-b border-border py-1.5">
      <Text class="w-20 text-xs text-muted-foreground">{label}</Text>
      <View class="min-w-0 flex-1">
        <Link label={href} href={href} />
      </View>
    </View>
  );
}

export function DetailSheet() {
  const {
    detailOpen,
    detailName,
    detailLoading,
    detail,
    copyDone,
    closeDetails,
    copyName,
    installFromDetails,
    updateFromDetails,
    uninstallApp,
  } = useDeck();

  return (
    <Sheet
      open={detailOpen()}
      onOpenChange={(event) => {
        if (!event.open) {
          closeDetails();
        }
      }}
      title={detailName() ?? "包详情"}
      description={detail()?.description ?? null}
      placement="right"
      closeLabel="关闭"
      footer={
        <View class="flex-row flex-wrap items-center justify-end gap-2">
          <If when={detail()}>
            {(data) => (
              <View class="flex-row flex-wrap items-center justify-end gap-2">
                <IconButton
                  icon="copy"
                  label={copyDone() ? "已复制包名" : "复制包名"}
                  tooltip={
                    <Tooltip
                      label={copyDone() ? "已复制" : "复制包名"}
                    />
                  }
                  onPress={() => void copyName(data().name)}
                />
                <If when={data().installedVersion === ""}>
                  <Button
                    label="安装"
                    variant="primary"
                    icon="download"
                    onPress={() => installFromDetails()}
                  />
                </If>
                <If
                  when={
                    data().installedVersion !== "" &&
                    data().installedVersion !== data().version
                  }
                >
                  <Button
                    label="更新"
                    variant="primary"
                    icon="arrow-up"
                    onPress={() => updateFromDetails()}
                  />
                </If>
                <If when={data().installedVersion !== ""}>
                  <Button
                    label="卸载"
                    variant="danger"
                    icon="trash"
                    onPress={() => {
                      closeDetails();
                      void uninstallApp(data().name);
                    }}
                  />
                </If>
              </View>
            )}
          </If>
        </View>
      }
    >
      <If when={detailLoading()}>
        <Text class="text-sm text-muted-foreground">正在读取清单…</Text>
      </If>
      <If when={detail()}>
        {(data) => (
          <View class="gap-1">
            {detailRow("版本", data().version)}
            <If when={isUrlSource(data().bucket)}>
              {detailLinkRow("来源", data().bucket)}
            </If>
            <If when={!isUrlSource(data().bucket)}>
              {detailRow("Bucket", data().bucket || "—")}
            </If>
            <View class="flex-row items-start gap-3 border-b border-border py-1.5">
              <Text class="w-20 text-xs text-muted-foreground">已安装</Text>
              <Text class={CELL}>{data().installedVersion || "未安装"}</Text>
            </View>
            <If
              when={
                data().installedVersion !== "" &&
                data().installedVersion !== data().version
              }
            >
              {detailRow("可更新至", data().version)}
            </If>
            <If when={data().homepage !== ""}>
              {detailLinkRow("主页", data().homepage)}
            </If>
            {detailRow(
              "占用",
              data().sizeBytes > 0 ? formatBytes(data().sizeBytes) : "—",
            )}
            {detailRow("安装路径", data().installedPath || "—")}
            {detailRow("许可证", data().license || "—")}
            {detailRow("依赖", data().depends || "—")}
            {detailRow("建议", data().suggest || "—")}
            {detailRow("下载地址", data().url || "—")}
            {detailRow("备注", data().notes || "—")}
            {detailRow("清单", data().manifestPath)}
          </View>
        )}
      </If>
    </Sheet>
  );
}
