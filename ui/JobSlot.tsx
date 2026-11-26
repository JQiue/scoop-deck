import { Text, View } from "nsh";
import { Button, Progress } from "./omarchy";
import { stageLabel } from "./ui";
import { canCancelJob, useDeck, type JobKind } from "./deck";

export function PreparingButton() {
  return <Button label="获取中" size="small" disabled />;
}

/** 安装/更新进行中的内容：进度条 + 阶段（取消按钮由外面决定是否显示）。 */
function InstallProgress(props: { kind: JobKind; stage: string }) {
  return (
    <View class="flex-row items-center gap-2">
      <Progress indeterminate />
      <Text class="text-xs font-medium text-foreground">
        {props.kind === "uninstall"
          ? "卸载中"
          : stageLabel(props.stage)}
      </Text>
    </View>
  );
}

/** 一个任务在行内占用的按钮：排队中 / 待安装 / 进度（可取消）。 */
export function JobSlot(props: { name: string; kind: JobKind }) {
  const { jobOf, cancelJob, retryJob, removeJob } = useDeck();
  const { name, kind } = props;

  return (
    <If when={jobOf(name, kind)}>
      {(job) => (
        <View class="flex-row items-center gap-1">
          <If when={job().status === "waiting"}>
            <Button
              label="排队中"
              size="small"
              variant="ghost"
              accessibilityLabel={`取消 ${name} 的排队`}
              onPress={() => void cancelJob(name, kind)}
            />
          </If>
          <If when={job().status === "ready"}>
            <Button
              label="待安装"
              size="small"
              variant="ghost"
              accessibilityLabel={`取消 ${name} 的安装`}
              onPress={() => void cancelJob(name, kind)}
            />
          </If>
          <If when={job().status === "downloading"}>
            <View class="flex-row items-center gap-2">
              <Progress
                value={job().percent ?? undefined}
                indeterminate={job().percent == null}
              />
              <Text class="text-xs font-medium text-foreground">
                {job().percent == null
                  ? stageLabel(job().stage)
                  : `${Math.round(job().percent ?? 0)}%`}
              </Text>
              <Button
                label="取消"
                size="small"
                variant="ghost"
                accessibilityLabel={`取消 ${name} 的下载`}
                onPress={() => void cancelJob(name, kind)}
              />
            </View>
          </If>
          <If when={job().status === "failed"}>
            <View class="flex-row items-center gap-1">
              <Button
                label="重试"
                size="small"
                onPress={() => retryJob(name, kind)}
              />
              <Button
                label="忽略"
                size="small"
                variant="ghost"
                accessibilityLabel={`忽略 ${name} 的失败`}
                onPress={() => removeJob(name, kind)}
              />
            </View>
          </If>
          <If when={job().status === "installing"}>
            <View class="flex-row items-center gap-2">
              <InstallProgress kind={kind} stage={job().stage} />
              <If when={canCancelJob(job())}>
                <Button
                  label="取消"
                  size="small"
                  variant="ghost"
                  accessibilityLabel={`取消 ${name} 的安装`}
                  onPress={() => void cancelJob(name, kind)}
                />
              </If>
            </View>
          </If>
        </View>
      )}
    </If>
  );
}
