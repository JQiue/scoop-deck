import { computed, Scroll, Text, View } from "nsh";
import { Button, Icon, IconButton, Popover } from "./omarchy";
import { jobStatusText } from "./ui";
import { canCancelJob, useDeck, type Job } from "./deck";
import { t } from "./i18n";

/** 进度条在左，状态文字在右；只有已知下载百分比才填充。 */
function JobProgressRow(props: { job: () => Job }) {
  const job = computed(props.job);
  const text = computed(() => jobStatusText(job()));
  const failed = computed(() => job().status === "failed");
  const determinate = computed(
    () => job().status === "downloading" && job().percent != null,
  );
  const percent = computed(() =>
    determinate() ? Math.max(0, Math.min(100, job().percent ?? 0)) : 0,
  );
  const active = computed(
    () => job().status === "downloading" || job().status === "installing",
  );

  return (
    <View class="w-full flex-row items-center gap-2">
      <View
        class={`relative h-1.5 flex-1 overflow-hidden rounded-(--radius) ${
          failed() ? "bg-destructive/10" : "bg-inset"
        }`}
      >
        <If when={determinate()}>
          <View
            class="bg-primary"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${percent()}%`,
            }}
          />
        </If>
        <If when={!determinate() && active()}>
          <View
            class="animate-pulse bg-muted"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
        </If>
      </View>
      <Text
        class={`shrink-0 text-xs ${
          failed() ? "text-destructive" : "text-muted-foreground"
        }`}
        style={{ numberOfLines: 1 }}
      >
        {text()}
      </Text>
    </View>
  );
}

/** 打开后显示的任务列表：进度、取消、失败后的重试/忽略。 */
function QueueList() {
  const { jobs, cancelJob, retryJob, removeJob } = useDeck();
  const ordered = computed(() =>
    [...jobs()].sort(
      (left, right) =>
        Number(right.status === "failed") - Number(left.status === "failed"),
    ),
  );

  return (
    <View style={{ width: 296 }}>
      <Scroll
        style={{ width: 296, maxHeight: 280 }}
        contentStyle={{ paddingBottom: 2 }}
      >
        <View class="gap-2" style={{ width: 296 }}>
          <Each of={ordered()} key={(job) => `${job.kind}/${job.name}`}>
            {(item) => (
              <View class="w-full gap-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <View class="flex-row items-center gap-2">
                  <Text
                    class="flex-1 text-sm font-semibold text-foreground"
                    style={{ numberOfLines: 1 }}
                  >
                    {item().name}
                  </Text>
                  <If when={canCancelJob(item())}>
                    <IconButton
                      icon="x"
                      size="small"
                      label={t("common.cancel")}
                      onPress={() => void cancelJob(item().name, item().kind)}
                    />
                  </If>
                </View>
                <JobProgressRow job={item} />
                <If when={item().status === "failed"}>
                  <View class="flex-row items-center justify-end gap-1">
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
                  </View>
                </If>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

/**
 * 队列状态 chip：只显示数量；有下载时附上平均百分比，有失败时优先显示失败。
 * 点击打开 Popover，任务详情不再占用页面布局。
 */
export function QueueIndicator() {
  const { jobs } = useDeck();
  const failed = computed(
    () => jobs().filter((job) => job.status === "failed").length,
  );
  const percent = computed(() => {
    const downloading = jobs().filter(
      (job) => job.status === "downloading",
    );

    if (
      downloading.length === 0 ||
      downloading.some((job) => job.percent == null)
    ) {
      return null;
    }

    const total = downloading.reduce(
      (sum, job) => sum + (job.percent ?? 0),
      0,
    );
    return Math.round(total / downloading.length);
  });
  const text = computed(() => {
    if (failed() > 0) {
      return t("queue.chipFailed", { count: failed() });
    }

    if (percent() != null) {
      return t("queue.chipProgress", {
        count: jobs().length,
        percent: percent(),
      });
    }

    return t("queue.chipCount", { count: jobs().length });
  });

  return (
    <If when={jobs().length > 0}>
      <Popover
        placement="bottom"
        align="end"
        trigger={
          <View
            role="button"
            focusable
            accessible
            accessibilityLabel={text()}
            accessibilityHint={t("queue.open")}
            class="h-6 flex-row items-center gap-1.5 rounded-(--radius) border border-border bg-background px-2 text-foreground transition-colors hover:bg-muted active:bg-accent focus-visible:border-ring focus-visible:bg-muted"
          >
            <If when={failed() > 0}>
              <Icon name="triangle-alert" size={13} class="text-warning" />
            </If>
            <If when={failed() === 0}>
              <Icon
                name="loader-circle"
                size={13}
                class="animate-spin text-muted-foreground"
              />
            </If>
            <Text class="text-xs">{text()}</Text>
          </View>
        }
      >
        <QueueList />
      </Popover>
    </If>
  );
}
