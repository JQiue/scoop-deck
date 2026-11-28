import {
  computed,
  type Accessor,
  type StyleProp,
  type ViewStyle,
  View,
  windowSize,
} from "nsh";
import { IconButton, Input, Progress } from "./omarchy";
import { t } from "./i18n";
import type { Job } from "./types";

// 窗口窄到这个宽度以下时，表格改成卡片、设置项改成上下排布。
export const COMPACT_WIDTH = 900;

/** 是否处于窄窗口布局（随窗口大小响应）。 */
export function useCompact(): Accessor<boolean> {
  return computed(() => windowSize().width < COMPACT_WIDTH);
}

// 列表页共用的卡片/工具条底色。
export const SURFACE = "overflow-hidden rounded-(--radius) border border-border bg-background";
export const CARD = "rounded-(--radius) border border-border bg-background";

// 常用输入框宽度，集中管理。
export const FIELD_W = 220;
export const FIELD_W_WIDE = 320;
export const FIELD_W_URL = 360;
export const FIELD_W_REPO = 420;

// 界面里反复用到的样式组合。
export const CELL = "text-sm text-foreground";
export const HEAD = "text-xs font-semibold text-muted-foreground";

/** 统一的输入框：Omarchy 的原生输入框，清空按钮在旁边。 */
export function TextField(props: {
  class?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <View
      class={`relative ${props.class ?? ""}`}
      style={props.style}
    >
      <Input
        testID={props.testID}
        accessibilityLabel={props.accessibilityLabel}
        class={
          props.value !== "" && props.onClear !== undefined
            ? "min-w-0 w-full pr-7"
            : "min-w-0 w-full"
        }
        style={
          props.value !== "" && props.onClear !== undefined
            ? { paddingRight: 28 }
            : undefined
        }
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.value)}
      />
      <If when={props.value !== "" && props.onClear !== undefined}>
        <View
          class="items-center justify-center"
          style={{ position: "absolute", top: 0, bottom: 0, right: 2 }}
        >
          <IconButton
            icon="x"
            size="small"
            label={props.clearLabel ?? t("ui.clear")}
            onPress={() => props.onClear?.()}
          />
        </View>
      </If>
    </View>
  );
}

// 搜索最多渲染多少行；bucket 全量可达数千条。
export const MAX_RESULTS = 100;

// 同时下载几个包（安装仍然是串行的）。
export const MAX_DOWNLOADS = 3;

// 窗口大小/位置在 Storage 里的键。
export const PLACEMENT_KEY = "window.placement";

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** 队列/行内进度显示的状态文字：只有下载中和安装中两个阶段。 */
export function jobStatusText(job: Job): string {
  switch (job.status) {
    case "waiting":
      return t("job.waiting");
    case "downloading":
      return job.percent == null
        ? t("job.downloading")
        : t("job.downloadingPercent", {
            percent: Math.round(job.percent),
          });
    case "ready":
      return t("job.ready");
    case "installing":
      return job.kind === "uninstall"
        ? t("job.uninstalling")
        : t("job.installing");
    default:
      return t("job.failed");
  }
}

/** 不确定进度的小动画。 */
export function Busy() {
  return <Progress indeterminate label={t("ui.busy")} />;
}
