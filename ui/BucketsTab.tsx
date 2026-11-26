import { Scroll, Text, View } from "nsh";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "nsh/base";
import { Button, EmptyState } from "./omarchy";
import {
  Busy,
  CARD,
  CELL,
  FIELD_W,
  FIELD_W_REPO,
  FIELD_W_URL,
  HEAD,
  SURFACE,
  TextField,
  useCompact,
} from "./ui";
import { useDeck } from "./deck";
import { t } from "./i18n";

interface BucketRow {
  name: string;
  appCount: number;
  source: string | null;
  installed: boolean;
}

function bucketForm(compact: boolean) {
  const { editing, editRepo, isBusy, saveBucket } = useDeck();
  return (
    <If when={editing()}>
      {(name) => (
        <View class={compact ? "gap-2" : "flex-row items-center gap-2"}>
          <Text class="text-sm text-foreground">
            {t("buckets.editSource", { name: name() })}
          </Text>
          <TextField
            testID="edit-bucket-repo"
            class={compact ? "w-full" : ""}
            style={compact ? undefined : { width: FIELD_W_REPO }}
            value={editRepo()}
            placeholder={t("buckets.sourcePlaceholder")}
            onClear={() => editRepo.set("")}
            onChange={(value) => editRepo.set(value)}
          />
          <View class="flex-row flex-wrap items-center gap-2">
            <Button
              label={t("common.save")}
              variant="primary"
              disabled={isBusy() || editRepo().trim() === ""}
              onPress={() => void saveBucket()}
            />
            <Button
              label={t("common.cancel")}
              disabled={isBusy()}
              onPress={() => editing.set(null)}
            />
            <If when={isBusy()}>
              <Busy />
            </If>
          </View>
        </View>
      )}
    </If>
  );
}

function addBucketForm(compact: boolean) {
  const {
    editing,
    newBucket,
    newBucketRepo,
    loadingBuckets,
    isBusy,
    addBucket,
  } = useDeck();
  return (
    <If when={!editing()}>
      <View class={compact ? "gap-2" : "flex-row items-center gap-2"}>
        <TextField
          testID="new-bucket"
          class={compact ? "w-full" : ""}
          style={compact ? undefined : { width: FIELD_W }}
          value={newBucket()}
          placeholder={t("buckets.namePlaceholder")}
          onClear={() => newBucket.set("")}
          onChange={(value) => newBucket.set(value)}
        />
        <TextField
          testID="new-bucket-repo"
          class={compact ? "w-full" : ""}
          style={compact ? undefined : { width: FIELD_W_URL }}
          value={newBucketRepo()}
          placeholder={t("buckets.repoPlaceholder")}
          onClear={() => newBucketRepo.set("")}
          onChange={(value) => newBucketRepo.set(value)}
        />
        <View class="flex-row flex-wrap items-center gap-2">
          <Button
            label={t("common.add")}
            variant="primary"
            icon="plus"
            disabled={isBusy() || newBucket().trim() === ""}
            onPress={() => void addBucket()}
          />
          <If when={loadingBuckets()}>
            <Busy />
          </If>
        </View>
      </View>
    </If>
  );
}

export function BucketsTab() {
  const {
    buckets,
    knownBuckets,
    loadingBuckets,
    startEdit,
    addKnownBucket,
    removeBucket,
    isBusy,
  } = useDeck();
  const compact = useCompact();

  /** 已添加的 bucket + 还没添加的已知 bucket，合成一张表。 */
  function bucketRows(): BucketRow[] {
    return [
      ...buckets().map((bucket) => ({
        name: bucket.name,
        appCount: bucket.appCount,
        source: bucket.source ?? null,
        installed: true,
      })),
      ...knownBuckets()
        .filter((bucket) => !bucket.installed)
        .map((bucket) => ({
          name: bucket.name,
          appCount: 0,
          source: bucket.repo,
          installed: false,
        })),
    ];
  }

  function rowActions(bucket: BucketRow) {
    return (
      <View class="flex-row flex-wrap items-center gap-1">
        <If when={bucket.installed}>
          <Button
            label={t("common.edit")}
            size="small"
            disabled={isBusy()}
            onPress={() => startEdit(bucket)}
          />
          <Button
            label={t("common.delete")}
            size="small"
            variant="danger"
            disabled={isBusy()}
            onPress={() => void removeBucket(bucket.name)}
          />
        </If>
        <If when={!bucket.installed}>
          <Button
            label={t("common.add")}
            size="small"
            variant="primary"
            icon="plus"
            disabled={isBusy()}
            onPress={() => void addKnownBucket(bucket.name)}
          />
        </If>
      </View>
    );
  }

  return (
    <View class="flex-1">
      <View class="gap-3 border-b border-border bg-background px-5 py-3">
        {bucketForm(compact())}
        {addBucketForm(compact())}
      </View>
      <Scroll class="flex-1" contentStyle={{ padding: 16 }}>
        <If when={!compact()}>
          <View class={SURFACE}>
            <Table accessibilityLabel={t("buckets.table")}>
              <TableHeader>
                <TableRow class="flex-row items-center gap-3 border-b border-border bg-muted px-3 py-2">
                  <TableHead class="flex-1"><Text class={HEAD}>{t("common.name")}</Text></TableHead>
                  <TableHead class="flex-1"><Text class={HEAD}>{t("buckets.count")}</Text></TableHead>
                  <TableHead style={{ flex: 2 }}><Text class={HEAD}>{t("common.source")}</Text></TableHead>
                  <TableHead class="flex-1"><Text class={HEAD}>{t("common.actions")}</Text></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <Each of={bucketRows()} key={(bucket) => bucket.name}>
                  {(item) => (
                    <TableRow class="flex-row items-center gap-3 border-b border-border px-3 py-2 hover:bg-accent active:bg-accent">
                      <TableCell class="flex-1">
                        <Text
                          class="text-sm font-semibold text-foreground"
                          style={{ numberOfLines: 1 }}
                        >
                          {item().name}
                        </Text>
                      </TableCell>
                      <TableCell class="flex-1">
                        <Text class={CELL}>
                          {item().installed ? item().appCount : "—"}
                        </Text>
                      </TableCell>
                      <TableCell style={{ flex: 2 }}>
                        <Text class={CELL} style={{ numberOfLines: 1 }}>
                          {item().source ?? "—"}
                        </Text>
                      </TableCell>
                      <TableCell class="flex-1">
                        {rowActions(item())}
                      </TableCell>
                    </TableRow>
                  )}
                </Each>
              </TableBody>
            </Table>
          </View>
        </If>
        <If when={compact()}>
          <View class="gap-2">
            <Each of={bucketRows()} key={(bucket) => bucket.name}>
              {(item) => (
                <View class={`gap-2 ${CARD} p-3`}>
                  <View class="flex-row items-center gap-2">
                    <Text
                      class="flex-1 text-sm font-semibold text-foreground"
                      style={{ numberOfLines: 1 }}
                    >
                      {item().name}
                    </Text>
                    <Text class="shrink-0 text-xs text-muted-foreground">
                      {item().installed
                        ? t("buckets.packages", { count: item().appCount })
                        : t("buckets.pending")}
                    </Text>
                  </View>
                  <Text
                    class="text-xs text-muted-foreground"
                    style={{ numberOfLines: 2 }}
                  >
                    {item().source ?? "—"}
                  </Text>
                  {rowActions(item())}
                </View>
              )}
            </Each>
          </View>
        </If>
        <If when={loadingBuckets() && bucketRows().length === 0}>
          <Text class="py-8 text-center text-sm text-muted-foreground">
            {t("buckets.loading")}
          </Text>
        </If>
        <If when={!loadingBuckets() && bucketRows().length === 0}>
          <EmptyState
            title={t("buckets.emptyTitle")}
            description={t("buckets.emptyHint")}
            icon="folder"
          />
        </If>
      </Scroll>
    </View>
  );
}
