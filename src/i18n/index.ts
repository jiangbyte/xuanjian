/**
 * @file i18n 初始化
 * @author Charlie
 * @description 加载中英文案资源，从 localStorage 恢复语言，并挂载 react-i18next。
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "@/i18n/locales/zh-CN";
import en from "@/i18n/locales/en";

const resources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
};

const savedLocale = localStorage.getItem("xuanjian.locale") || "zh-CN";

i18n.use(initReactI18next).init({
  resources,
  lng: savedLocale,
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
});

export default i18n;
