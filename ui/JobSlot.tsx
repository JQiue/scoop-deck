import { View } from "nsh";
import { Button, IconButton, Tooltip } from "./omarchy";
import { jobStatusText } from "./ui";
import { canCancelJob, useDeck, type Job, type JobKind } from "./deck";
import { t } from "./i18n";

export function PreparingButton() {
  const label = t("job.preparing");

  return (
    <IconButton
      icon="loader-circle"
      label={label}
      size="small"
      variant="default"
      loading
      tooltip={<Tooltip label={label} />}
    />
  );
}

/** 行内任务的取消按钮：读屏说明带应用名，视觉上只有图标。 */
function cancelLabel(kind: JobKind, status: Job["status"], name: string): string {
  if (status === "downloading") {
    return t("job.cancelDownload", { name });
  }

  if (status === "installing" || (status === "ready" && kind !== "uninstall")) {
    return t("job.cancelInstall", { name });
  }

  return t("job.cancelQueue", { name });
}

/** 一个任务在行内占用的位置：转圈的进度图标，可取消时旁边再加一个取消图标。 */
export function JobSlot(props: { name: string; kind: JobKind }) {
  const { jobOf, cancelJob, retryJob, removeJob } = useDeck();
  const { name, kind } = props;

  return (
    <If when={jobOf(name, kind)}>
      {(job) => (
        <View class="flex-row items-center gap-1">
          <If when={job().status === "failed"}>
            <View class="flex-row items-center gap-1">
              <Button
                label={t("common.retry")}
                size="small"
                onPress={() => retryJob(name, kind)}
              />
              <Button
                label={t("common.ignore")}
                size="small"
                variant="ghost"
                accessibilityLabel={t("job.ignoreFailure", { name })}
                onPress={() => removeJob(name, kind)}
              />
            </View>
          </If>
          <If when={job().status !== "failed"}>
            <View class="flex-row items-center gap-1">
              <IconButton
                icon="loader-circle"
                label={jobStatusText(job())}
                size="small"
                variant="default"
                loading
                tooltip={<Tooltip label={jobStatusText(job())} />}
              />
              <If when={canCancelJob(job())}>
                <IconButton
                  icon="x"
                  label={cancelLabel(kind, job().status, name)}
                  size="small"
                  tooltip={<Tooltip label={t("common.cancel")} />}
                  onPress={() => void cancelJob(name, kind)}
                />
              </If>
            </View>
          </If>
        </View>
      )}
    </If>
  );
}
