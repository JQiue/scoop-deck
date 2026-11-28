// 应用内的轻量 toast：图标、文本和关闭按钮在同一行垂直居中。
// 不用 Omarchy 的 Toaster，因为它的图标固定在顶部，带多行文本时会错位。
import { signal, Text, View } from "nsh";
import { Icon, IconButton, type IconName } from "./omarchy";
import { t } from "./i18n";

export type ToastKind = "info" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const ICONS: Record<ToastKind, IconName> = {
  info: "info",
  success: "circle-check",
  warning: "triangle-alert",
  error: "circle-alert",
};

const COLORS: Record<ToastKind, string> = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

const items = signal<ToastItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let next = 0;

/** 显式关闭一条提示。 */
export function dismissToast(id: number) {
  const timer = timers.get(id);

  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }

  items.set(items().filter((item) => item.id !== id));
}

/** 弹出一条提示；默认 3.5 秒后自动关闭。 */
export function notify(text: string, kind: ToastKind = "info", timeout = 3500) {
  const id = ++next;
  items.set([...items(), { id, text, kind }]);

  if (timeout > 0) {
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        items.set(items().filter((item) => item.id !== id));
      }, timeout),
    );
  }
}

/** 右下角的提示栈；只挂一次。 */
export function ToastHost() {
  return (
    <View
      class="items-end gap-2 p-4"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "box-none",
      }}
    >
      <Each of={items()} key={(item) => item.id}>
        {(item) => (
          <View
            class="w-full max-w-[340px] flex-row items-center gap-2 overflow-hidden rounded-(--radius) border border-border bg-background px-3 py-2 shadow-lg"
            style={{ pointerEvents: "auto" }}
          >
            <Icon name={ICONS[item().kind]} size={16} class={COLORS[item().kind]} />
            <Text
              class="min-w-0 flex-1 text-sm text-foreground whitespace-normal"
              style={{ numberOfLines: 3 }}
            >
              {item().text}
            </Text>
            <IconButton
              icon="x"
              size="small"
              label={t("common.close")}
              onPress={() => dismissToast(item().id)}
            />
          </View>
        )}
      </Each>
    </View>
  );
}
