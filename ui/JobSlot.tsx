import { Text, View } from "nsh";
import { Button, Progress } from "./omarchy";
import { stageLabel } from "./ui";
import { canCancelJob, useDeck, type JobKind } from "./deck";
import { t } from "./i18n";

export function PreparingButton() {
  return <Button label={t("job.preparing")} size="small" disabled />;
}

/** 安装/更新进行中的内容：进度条 + 阶段（取消按钮由外面决定是否显示）。 */
function InstallProgress(props: { kind: JobKind; stage: string }) {
  return (
    <View class="flex-row items-center gap-2">
      <Progress indeterminate />
      <Text class="text-xs font-medium text-foreground">
        {props.kind === "uninstall"
          ? t("job.uninstalling")
          : stageLabel(props.stage)}
      </Text>
    </View>
  );
}

/** 一个任务在行内占用的按钮：排队中 / 待安装 / 进度（可取消）。 */
export function JobSlot(props: { name: string; kind: JobKind }) {
  const { jobOf, cancelJob, retryJob, removeJob } = useDeck();
  const { name, kind } = props;

  return (
    <If when={jobOf(name, kind)}>
      {(job) => (
        <View class="flex-row items-center gap-1">
          <If when={job().status === "waiting"}>
            <Button
              label={t("job.waiting")}
              size="small"
              variant="ghost"
              accessibilityLabel={t("job.cancelQueue", { name })}
              onPress={() => void cancelJob(name, kind)}
            />
          </If>
          <If when={job().status === "ready"}>
            <Button
              label={t("job.ready")}
              size="small"
              variant="ghost"
              accessibilityLabel={t("job.cancelInstall", { name })}
              onPress={() => void cancelJob(name, kind)}
            />
          </If>
          <If when={job().status === "downloading"}>
            <View class="flex-row items-center gap-2">
              <Progress
                value={job().percent ?? undefined}
                indeterminate={job().percent == null}
              />
              <Text class="text-xs font-medium text-foreground">
                {job().percent == null
                  ? stageLabel(job().stage)
                  : `${Math.round(job().percent ?? 0)}%`}
              </Text>
              <Button
                label={t("common.cancel")}
                size="small"
                variant="ghost"
                accessibilityLabel={t("job.cancelDownload", { name })}
                onPress={() => void cancelJob(name, kind)}
              />
            </View>
          </If>
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
          <If when={job().status === "installing"}>
            <View class="flex-row items-center gap-2">
              <InstallProgress kind={kind} stage={job().stage} />
              <If when={canCancelJob(job())}>
                <Button
                  label={t("common.cancel")}
                  size="small"
                  variant="ghost"
                  accessibilityLabel={t("job.cancelInstall", { name })}
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
