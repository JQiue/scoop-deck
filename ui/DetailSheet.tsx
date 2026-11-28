import { Text, View } from "nsh";
import { Button, IconButton, Link, Sheet, Tooltip } from "./omarchy";
import { CELL, formatBytes } from "./ui";
import { useDeck } from "./deck";
import { isUrlSource } from "./types";
import { t } from "./i18n";

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
    <If when={detailOpen()}>
      <Sheet
        open={detailOpen()}
      onOpenChange={(event) => {
        if (!event.open) {
          closeDetails();
        }
      }}
      title={detailName() ?? t("detail.title")}
      description={detail()?.description ?? null}
      placement="right"
      closeLabel={t("common.close")}
      footer={
        <View class="flex-row flex-wrap items-center justify-end gap-2">
          <If when={detail()}>
            {(data) => (
              <View class="flex-row flex-wrap items-center justify-end gap-2">
                <IconButton
                  icon="copy"
                  label={copyDone() ? t("detail.copiedName") : t("detail.copyName")}
                  tooltip={
                    <Tooltip
                      label={copyDone() ? t("detail.copied") : t("detail.copyName")}
                    />
                  }
                  onPress={() => void copyName(data().name)}
                />
                <If when={data().installedVersion === ""}>
                  <Button
                    label={t("common.install")}
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
                    label={t("common.update")}
                    variant="primary"
                    icon="arrow-up"
                    onPress={() => updateFromDetails()}
                  />
                </If>
                <If when={data().installedVersion !== ""}>
                  <Button
                    label={t("common.uninstall")}
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
        <Text class="text-sm text-muted-foreground">{t("detail.loading")}</Text>
      </If>
      <If when={detail()}>
        {(data) => (
          <View class="gap-1">
            {detailRow(t("common.version"), data().version)}
            <If when={isUrlSource(data().bucket)}>
              {detailLinkRow(t("common.source"), data().bucket)}
            </If>
            <If when={!isUrlSource(data().bucket)}>
              {detailRow(t("common.bucket"), data().bucket || "—")}
            </If>
            <View class="flex-row items-start gap-3 border-b border-border py-1.5">
              <Text class="w-20 text-xs text-muted-foreground">{t("detail.installed")}</Text>
              <Text class={CELL}>{data().installedVersion || t("detail.notInstalled")}</Text>
            </View>
            <If
              when={
                data().installedVersion !== "" &&
                data().installedVersion !== data().version
              }
            >
              {detailRow(t("detail.updateTo"), data().version)}
            </If>
            <If when={data().homepage !== ""}>
              {detailLinkRow(t("detail.homepage"), data().homepage)}
            </If>
            {detailRow(
              t("detail.size"),
              data().sizeBytes > 0 ? formatBytes(data().sizeBytes) : "—",
            )}
            {detailRow(t("detail.installPath"), data().installedPath || "—")}
            {detailRow(t("detail.license"), data().license || "—")}
            {detailRow(t("detail.depends"), data().depends || "—")}
            {detailRow(t("detail.suggest"), data().suggest || "—")}
            {detailRow(t("detail.downloadUrl"), data().url || "—")}
            {detailRow(t("detail.notes"), data().notes || "—")}
            {detailRow(t("detail.manifest"), data().manifestPath)}
          </View>
        )}
      </If>
      </Sheet>
    </If>
  );
}
