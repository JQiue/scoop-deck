import { signal, Scroll, Text, View } from "nsh";
import { Badge, Button, Panel, Progress } from "./omarchy";
import { stageLabel } from "./ui";
import { canCancelJob, useDeck, type Job, type JobKind } from "./deck";
import { t } from "./i18n";

function kindLabel(kind: JobKind): string {
  switch (kind) {
    case "install":
      return t("common.install");
    case "update":
      return t("common.update");
    default:
      return t("common.uninstall");
  }
}

function jobStatus(job: Job): string {
  switch (job.status) {
    case "waiting":
      return t("job.waiting");
    case "downloading":
      return job.percent == null
        ? t("queue.downloadingStage", { stage: stageLabel(job.stage) })
        : t("queue.downloadingPercent", {
            percent: Math.round(job.percent),
          });
    case "ready":
      return t("job.ready");
    case "installing":
      return job.kind === "uninstall"
        ? t("job.uninstalling")
        : stageLabel(job.stage);
    default:
      return t("job.failed");
  }
}

function jobProgress(job: Job) {
  return (
    <Progress
      value={
        job.status === "downloading" && job.percent != null
          ? job.percent
          : undefined
      }
      indeterminate={
        (job.status === "downloading" && job.percent == null) ||
        job.status === "installing"
      }
    />
  );
}

/** 有任务时停在窗口底部的队列面板。 */
export function QueueDock() {
  const { jobs, cancelJob, retryJob, removeJob } = useDeck();
  const open = signal(false);

  return (
    <If when={jobs().length > 0}>
      <View class="border-t border-border bg-background">
        <If when={open()}>
          <Panel title={t("queue.title")} variant="outline" class="m-3">
            <Scroll
              style={{ maxHeight: 160 }}
              contentStyle={{ paddingBottom: 8 }}
            >
              <View class="gap-2 py-2">
                <Each of={jobs()} key={(job) => `${job.kind}/${job.name}`}>
                  {(item) => (
                    <View class="gap-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                      <View class="flex-row items-center gap-2">
                        <Text
                          class="flex-1 text-sm font-semibold text-foreground"
                          style={{ numberOfLines: 1 }}
                        >
                          {item().name}
                        </Text>
                        <Text class="text-xs text-muted-foreground">
                          {kindLabel(item().kind)}
                        </Text>
                      </View>
                      {jobProgress(item())}
                      <View class="flex-row items-center gap-2">
                        <Text class="flex-1 text-xs text-muted-foreground">
                          {jobStatus(item())}
                        </Text>
                        <If when={item().status === "failed"}>
                          <Button
                            label={t("common.retry")}
                            size="small"
                            onPress={() => retryJob(item().name, item().kind)}
                          />
                          <Button
                            label={t("common.ignore")}
                            size="small"
                            variant="ghost"
                            onPress={() => removeJob(item().name, item().kind)}
                          />
                        </If>
                        <If when={canCancelJob(item())}>
                          <Button
                            label={t("common.cancel")}
                            size="small"
                            variant="ghost"
                            onPress={() =>
                              void cancelJob(item().name, item().kind)
                            }
                          />
                        </If>
                      </View>
                    </View>
                  )}
                </Each>
              </View>
            </Scroll>
          </Panel>
        </If>
        <View class="flex-row items-center gap-3 px-4 py-2">
          <Badge
            label={t("queue.count", { count: jobs().length })}
            variant="primary"
            size="large"
          />
          <Text class="flex-1 text-xs text-muted-foreground">
            {t("queue.hint")}
          </Text>
          <Button
            label={open() ? t("common.collapse") : t("common.expand")}
            icon={open() ? "chevron-down" : "chevron-up"}
            size="small"
            variant="ghost"
            accessibilityLabel={
              open() ? t("queue.close") : t("queue.open")
            }
            onPress={() => open.update((value) => !value)}
          />
        </View>
      </View>
    </If>
  );
}
