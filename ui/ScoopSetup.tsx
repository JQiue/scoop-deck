import { Text, View } from "nsh";
import { Button, Link, Panel } from "./omarchy";
import { useDeck } from "./deck";

/** 没检测到 Scoop 时占满窗口的安装引导。 */
export function ScoopSetup() {
  const { checkScoop } = useDeck();

  return (
    <View class="flex-1 items-center justify-center gap-4 bg-background px-6">
      <Text class="text-xl font-bold text-foreground">未检测到 Scoop</Text>
      <Text class="max-w-[560px] text-center text-sm text-muted-foreground">
        ScoopDeck 需要先安装 Scoop。装好后回到这里点「重新检测」；如果仍然检测不到，重启一次
        ScoopDeck。
      </Text>
      <Panel title="在 PowerShell 中运行" variant="outline" class="w-full max-w-[560px]">
        <View class="gap-2 py-2">
          <Text class="font-mono text-sm text-foreground">
            Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
          </Text>
          <Text class="font-mono text-sm text-foreground">
            irm get.scoop.sh | iex
          </Text>
        </View>
      </Panel>
      <View class="flex-row items-center gap-3">
        <Link label="打开 scoop.sh" href="https://scoop.sh" />
        <Button
          label="重新检测"
          variant="primary"
          onPress={() => void checkScoop()}
        />
      </View>
    </View>
  );
}
