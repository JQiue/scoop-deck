import { effect, signal, Storage } from "nsh";
import { setLocale, t } from "nsh/i18n";

/** 语言选择：跟随系统，或固定中文/英文。 */
export type LanguagePreference = "system" | "zh-CN" | "en";

const LANGUAGE_KEY = "language.preference";

const preference = signal<LanguagePreference>("system");
let started = false;

export { t };

export function languagePreference(): LanguagePreference {
  return preference();
}

/** 切换语言：立即生效，并保存到本机。 */
export function setLanguagePreference(value: LanguagePreference) {
  preference.set(value);
  void Storage.setItem(LANGUAGE_KEY, value).catch(() => {
    // 存不下只影响下次启动的默认值。
  });
}

/** 启动时恢复上次的语言选择；system 时跟随 Windows。 */
export function startLanguage() {
  if (started) {
    return;
  }

  started = true;

  effect(() => {
    const value = preference();
    setLocale(value === "system" ? null : value);
  });

  void Storage.getItem(LANGUAGE_KEY)
    .then((saved) => {
      if (saved === "system" || saved === "zh-CN" || saved === "en") {
        preference.set(saved);
      }
    })
    .catch(() => {
      // 读不到就跟随系统。
    });
}
