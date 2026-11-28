// 长文本 tooltip：在 320pt 内换行，避免文字跑出气泡边框。
// 短标签仍可用 Omarchy 的 `Tooltip`。
import { Text } from "nsh";
import { Tooltip as BaseTooltip } from "nsh/base";

export function HintTooltip(props: { label: string }) {
  return (
    <BaseTooltip
      delay={400}
      class="max-w-[320px] overflow-hidden rounded-(--radius) border border-border bg-surface px-2 py-1"
    >
      <Text
        class="text-xs text-foreground whitespace-normal"
        style={{ numberOfLines: 6 }}
      >
        {props.label}
      </Text>
    </BaseTooltip>
  );
}
