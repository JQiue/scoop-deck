import {
  computed,
  effect,
  ErrorBoundary,
  mount,
  Overlay,
  Storage,
  Text,
  View,
} from "nsh";
import { Button, Tab, Tabs, Toaster } from "./omarchy";
import { Application, Tray, Window } from "nsh/desktop";
import trayIcon from "./assets/tray.png";
import {
  DeckContext,
  TAB_BUCKETS,
  TAB_INSTALLED,
  TAB_SEARCH,
  TAB_SETTINGS,
  createDeck,
} from "./deck";
import { InstalledTab } from "./InstalledTab";
import { SearchTab } from "./SearchTab";
import { BucketsTab } from "./BucketsTab";
import { DetailSheet } from "./DetailSheet";
import { ErrorToast } from "./ErrorBanner";
import { QueueDock } from "./QueueDock";
import { ScoopSetup } from "./ScoopSetup";
import { SettingsTab } from "./SettingsTab";
import { startLanguage, t } from "./i18n";
import { startTheme } from "./theme";
import { PLACEMENT_KEY } from "./ui";

function showMainWindow() {
  const main = Window.get("main");

  if (main) {
    main.show();
    main.focus();
  }
}

const TAB_VALUES = ["installed", "search", "buckets", "settings"] as const;
const TAB_IDS = [TAB_INSTALLED, TAB_SEARCH, TAB_BUCKETS, TAB_SETTINGS];

function App() {
  const deck = createDeck();
  const { tab, scoopAvailable } = deck;

  startLanguage();
  startTheme();

  function selectTab(value: string) {
    const index = TAB_VALUES.indexOf(value as (typeof TAB_VALUES)[number]);

    if (index >= 0) {
      tab.set(TAB_IDS[index]);
    }
  }

  effect(() => {
    const main = Window.get("main");

    if (!main) {
      return;
    }

    main.set({ title: "ScoopDeck", minSize: { width: 640, height: 480 } });

    // 记住窗口大小/位置：启动时恢复，改动后防抖保存。
    void Storage.getItem(PLACEMENT_KEY)
      .then((saved) => {
        if (!saved) {
          return;
        }

        try {
          main.setPlacement(JSON.parse(saved));
        } catch {
          // 存档坏了就当没存过，用默认尺寸。
        }
      })
      .catch(() => {
        // 读不到窗口位置不影响打开。
      });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = main.on("boundsChange", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const placement = main.state()?.placement;

        if (placement) {
          void Storage.setItem(
            PLACEMENT_KEY,
            JSON.stringify(placement),
          ).catch(() => {
            // 保存失败只影响下次启动的位置。
          });
        }
      }, 600);
    });

    // 回到窗口时刷新列表：别的窗口用 scoop 装/卸过也能看到。
    const stopFocus = main.on("focusChange", (event) => {
      if (
        event.focused &&
        deck.scoopAvailable() === true &&
        !deck.isBusy()
      ) {
        void deck.loadInstalled();
      }
    });

    return () => {
      clearTimeout(timer);
      stop();
      stopFocus();
    };
  });

  // 关闭窗口只收进托盘；真正退出走托盘菜单，避免后台下载被误关。
  effect(() => {
    const main = Window.get("main");

    if (!main) {
      return;
    }

    main.set({ closeOnPress: false });

    const stopClose = main.on("closePress", () => {
      main.hide();
    });
    const stopSecond = Application.on("secondInstance", showMainWindow);

    return () => {
      stopClose();
      stopSecond();
      Tray.set(null);
    };
  });

  // 托盘菜单和提示只跟随任务数量/阶段变化，不跟着每次百分比刷新。
  const trayQueueCount = computed(() => deck.jobs().length);
  const trayTooltip = computed(() => {
    const jobs = deck.jobs();
    const count = jobs.length;

    if (count === 0) {
      return t("tray.tooltipIdle");
    }

    const running = jobs.find(
      (job) => job.status === "downloading" || job.status === "installing",
    );
    const activity = running
      ? `${running.name} ${
          running.status === "downloading"
            ? t("tray.downloading")
            : running.kind === "uninstall"
              ? t("tray.uninstalling")
              : t("tray.installing")
        }`
      : "";

    return activity
      ? t("tray.tooltip", { activity, count })
      : `ScoopDeck · ${t("tray.queue", { count })}`;
  });

  effect(() => {
    const count = trayQueueCount();
    const tooltip = trayTooltip();

    Tray.set({
      icon: trayIcon,
      tooltip,
      menu: [
        { label: t("tray.show"), onSelect: showMainWindow },
        {
          label:
            count > 0
              ? t("tray.queue", { count })
              : t("tray.queueEmpty"),
          disabled: count === 0,
          onSelect: showMainWindow,
        },
        { type: "separator" },
        { label: t("tray.quit"), onSelect: () => Application.quit() },
      ],
      onClick: showMainWindow,
    });
  });

  effect(() => {
    void deck.checkScoop();
  });

  return (
    <DeckContext.Provider value={deck}>
      <View
        class="flex-1 bg-background"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
        }}
      >
        <If when={scoopAvailable() === null}>
          <View class="flex-1 items-center justify-center">
            <Text class="text-sm text-muted-foreground">{t("app.checking")}</Text>
          </View>
        </If>
        <If when={scoopAvailable() === false}>
          <ScoopSetup />
        </If>
        <If when={scoopAvailable() === true}>
          <View class="bg-background px-4">
            <Tabs
              value={TAB_VALUES[tab()]}
              variant="underline"
              accessibilityLabel={t("app.nav")}
              onChange={({ value }) => selectTab(value)}
            >
              <Tab
                testID="tab-installed"
                value="installed"
                label={t("tabs.installed")}
                icon="download"
              />
              <Tab
                testID="tab-search"
                value="search"
                label={t("tabs.search")}
                icon="search"
              />
              <Tab
                testID="tab-buckets"
                value="buckets"
                label={t("tabs.buckets")}
                icon="folder"
              />
              <Tab
                testID="tab-settings"
                value="settings"
                label={t("tabs.settings")}
                icon="settings"
              />
            </Tabs>
          </View>

          <View class="flex-1">
            <If when={tab() === TAB_INSTALLED}>
              <InstalledTab />
            </If>
            <If when={tab() === TAB_SEARCH}>
              <SearchTab />
            </If>
            <If when={tab() === TAB_BUCKETS}>
              <BucketsTab />
            </If>
            <If when={tab() === TAB_SETTINGS}>
              <SettingsTab />
            </If>
            <Overlay
              style={{
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: "box-none",
              }}
            >
              <Toaster />
            </Overlay>
          </View>

          <DetailSheet />
          <QueueDock />
          <ErrorToast />
        </If>
      </View>
    </DeckContext.Provider>
  );
}

function ErrorScreen(props: { error: unknown; reset: () => void }) {
  return (
    <View class="flex-1 items-center justify-center gap-3 bg-background p-6">
      <Text class="text-lg font-bold text-foreground">{t("app.errorTitle")}</Text>
      <Text
        class="max-w-[680px] text-sm text-destructive"
        style={{ numberOfLines: 10 }}
      >
        {String(props.error)}
      </Text>
      <Button label={t("app.retry")} variant="primary" onPress={props.reset} />
    </View>
  );
}

function Root() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <ErrorScreen error={error} reset={reset} />
      )}
    >
      <App />
    </ErrorBoundary>
  );
}

mount(Root);
