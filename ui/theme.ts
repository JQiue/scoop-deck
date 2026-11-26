import { colorScheme, effect, setColorScheme, signal, Storage } from "nsh";

/** 外观选择：跟随系统，或固定浅色/深色。 */
export type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "theme.preference";

/** 设置页和窗口外观共用的当前选择。 */
const preference = signal<ThemePreference>("system");
let started = false;

export function themePreference(): ThemePreference {
  return preference();
}

/** 切换外观：立即生效，并保存到本机。 */
export function setThemePreference(value: ThemePreference) {
  preference.set(value);
  void Storage.setItem(THEME_KEY, value).catch(() => {
    // 存不下只影响下次启动的默认值。
  });
}

/**
 * 启动时恢复上次的选择，并让外观跟随它。
 * `system` 时读取 `colorScheme()`，Windows 切换深浅色会跟着变。
 */
export function startTheme() {
  if (started) {
    return;
  }

  started = true;

  effect(() => {
    const value = preference();

    if (value === "system") {
      // 让 system 模式订阅系统外观变化。
      void colorScheme();
    }

    // 主题文件本身按 appearance 提供深浅两套 token；这里只切外观。
    setColorScheme(value === "system" ? "system" : value);
  });

  void Storage.getItem(THEME_KEY)
    .then((saved) => {
      if (saved === "system" || saved === "light" || saved === "dark") {
        preference.set(saved);
      }
    })
    .catch(() => {
      // 读不到就保持跟随系统。
    });
}
