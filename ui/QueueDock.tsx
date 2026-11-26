import { signal, Scroll, Text, View } from "nsh";
import { Badge, Button, Panel, Progress } from "./omarchy";
import { stageLabel } from "./ui";
import { canCancelJob, useDeck, type Job, type JobKind } from "./deck";

function kindLabel(kind: JobKind): string {
  switch (kind) {
    case "install":
      return "安装";
    case "update":
      return "更新";
    default:
      return "卸载";
  }
}

function jobStatus(job: Job): string {
  switch (job.status) {
    case "waiting":
      return "排队中";
    case "downloading":
      return job.percent == null
        ? `下载 · ${stageLabel(job.stage)}`
        : `下载 ${Math.round(job.percent)}%`;
    case "ready":
      return "待安装";
    case "installing":
      return job.kind === "uninstall"
        ? "卸载中"
        : stageLabel(job.stage);
    default:
      return "失败";
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
          <Panel title="下载队列" variant="outline" class="m-3">
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
                            label="重试"
                            size="small"
                            onPress={() => retryJob(item().name, item().kind)}
                          />
                          <Button
                            label="忽略"
                            size="small"
                            variant="ghost"
                            onPress={() => removeJob(item().name, item().kind)}
                          />
                        </If>
                        <If when={canCancelJob(item())}>
                          <Button
                            label="取消"
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
            label={`队列（${jobs().length}）`}
            variant="primary"
            size="large"
          />
          <Text class="flex-1 text-xs text-muted-foreground">
            下载最多 3 个并行，安装逐个进行
          </Text>
          <Button
            label={open() ? "收起" : "展开"}
            icon={open() ? "chevron-down" : "chevron-up"}
            size="small"
            variant="ghost"
            accessibilityLabel={open() ? "收起下载队列" : "展开下载队列"}
            onPress={() => open.update((value) => !value)}
          />
        </View>
      </View>
    </If>
  );
}
