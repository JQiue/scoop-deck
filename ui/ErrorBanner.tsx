import { Clipboard, effect, Scroll, signal, Text, View } from "nsh";
import { Button } from "./omarchy";
import { useDeck } from "./deck";

/** 操作失败的浮动提示：顶部居中，不挤占页面布局。 */
export function ErrorToast() {
  const { error, notify } = useDeck();
  const expanded = signal(false);

  // 新错误默认折叠成一行。
  effect(() => {
    if (error()) {
      expanded.set(false);
    }
  });

  return (
    <If when={error()}>
      {(message) => (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          {/* 点面板外面关闭；面板本身设为 pointer-events:auto，避免误关。 */}
          <View
            class="bg-transparent"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onPress={() => error.set(null)}
          />
          <View
            style={{
              position: "absolute",
              top: 60,
              left: 0,
              right: 0,
              pointerEvents: "none",
            }}
            class="items-center px-4"
          >
            <View
              style={{ pointerEvents: "auto" }}
              class={`relative flex w-full max-w-[720px] flex-col rounded-(--radius) border border-destructive/40 bg-background shadow-lg ${
                expanded() ? "p-3" : "px-3 py-2"
              }`}
            >
              <If when={!expanded()}>
                <View
                  style={{ cursor: "pointer" }}
                  class="w-full flex-row items-center gap-2"
                  onPress={() => expanded.set(true)}
                >
                  <Text
                    class="flex-1 text-sm text-destructive"
                    style={{ numberOfLines: 1 }}
                  >
                    {message()}
                  </Text>
                  <Text class="shrink-0 text-xs text-muted-foreground">
                    展开
                  </Text>
                </View>
              </If>
              <If when={expanded()}>
                <Scroll
                  class="w-full"
                  style={{ maxHeight: 220 }}
                  contentStyle={{ paddingRight: 0 }}
                >
                  <Text class="text-sm text-destructive">{message()}</Text>
                </Scroll>
              </If>
              {/* 操作按钮常驻，不依赖 hover；展开后也不会盖住滚动区域。 */}
              <If when={expanded()}>
                <View class="mt-2 flex-row items-center justify-end gap-1 border-t border-border pt-2">
                  <Button
                    label="复制"
                    size="small"
                    variant="ghost"
                    onPress={() => {
                      void Clipboard.writeText(message());
                      notify("错误信息已复制");
                    }}
                  />
                  <Button
                    label="收起"
                    size="small"
                    variant="ghost"
                    onPress={() => expanded.set(false)}
                  />
                  <Button
                    label="关闭"
                    size="small"
                    variant="ghost"
                    onPress={() => error.set(null)}
                  />
                </View>
              </If>
            </View>
          </View>
        </View>
      )}
    </If>
  );
}
