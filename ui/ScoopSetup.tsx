import { Text, View } from "nsh";
import { Button, Link, Panel } from "./omarchy";
import { useDeck } from "./deck";
import { t } from "./i18n";

/** 没检测到 Scoop 时占满窗口的安装引导。 */
export function ScoopSetup() {
  const { checkScoop } = useDeck();

  return (
    <View class="flex-1 items-center justify-center gap-4 bg-background px-6">
      <Text class="text-xl font-bold text-foreground">{t("setup.title")}</Text>
      <Text class="max-w-[560px] text-center text-sm text-muted-foreground">
        {t("setup.desc")}
      </Text>
      <Panel title={t("setup.powershell")} variant="outline" class="w-full max-w-[560px]">
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
        <Link label={t("setup.open")} href="https://scoop.sh" />
        <Button
          label={t("setup.retry")}
          variant="primary"
          onPress={() => void checkScoop()}
        />
      </View>
    </View>
  );
}
