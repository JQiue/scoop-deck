// 应用内的确认框：用 Omarchy 的 `Dialog` 画，跟随主题，而不是
// `nsh-omarchy` 的 `confirm()`（Windows 上会画成 WinUI3 风格的平台弹窗）。
import { signal, View } from "nsh";
import { Button, Dialog, type Tone } from "./omarchy";
import { t } from "./i18n";

/** 一次确认请求；字段和原来的 `confirm()` 保持一致。 */
export interface ConfirmRequest {
  title: string;
  description?: string;
  actionLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
}

const request = signal<ConfirmRequest | null>(null);
const visible = signal(false);

/** 当前请求的 resolve；同一时间只允许一个确认框。 */
let pending: ((ok: boolean) => void) | null = null;

/** 弹出确认框：确认返回 true，取消/Escape 返回 false。 */
export function confirm(options: ConfirmRequest): Promise<boolean> {
  // 上一个确认框还开着就按取消处理，避免两个 Promise 都悬着。
  const previous = pending;
  pending = null;
  previous?.(false);

  request.set(options);
  visible.set(true);

  return new Promise<boolean>((resolve) => {
    pending = resolve;
  });
}

function settle(ok: boolean) {
  const resolve = pending;

  if (!resolve) {
    return;
  }

  pending = null;
  visible.set(false);
  resolve(ok);
}

export function ConfirmHost() {
  return (
    <Dialog
      title={request()?.title ?? ""}
      description={request()?.description ?? null}
      open={visible()}
      // 和 `AlertDialog` 一样：点背景不关闭，只有按钮和 Escape 能关。
      closeOnBackdropPress={false}
      onOpenChange={(event) => {
        if (!event.open) {
          settle(false);
        }
      }}
      footer={
        <View class="flex-row justify-end gap-2">
          <Button
            label={request()?.cancelLabel ?? t("common.cancel")}
            onPress={() => settle(false)}
          />
          <Button
            label={request()?.actionLabel ?? t("common.ok")}
            variant={request()?.tone === "danger" ? "danger" : "primary"}
            onPress={() => settle(true)}
          />
        </View>
      }
    />
  );
}
