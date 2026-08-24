/**
 * Тема оформления.
 *
 * Выбор хранится в localStorage и применяется атрибутом `data-theme` на <html>.
 * Тема — свойство устройства, а не учетной записи: она нужна и гостю на форме
 * входа, поэтому на сервер ничего не уходит.
 *
 * Первичная установка атрибута происходит в index.html до загрузки модулей —
 * иначе страница успевает мигнуть темной перед переключением на светлую.
 */

import { THEME, THEMES, THEME_STORAGE_KEY } from '/shared/constants.js';

const listeners = new Set();

function read() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === THEME.LIGHT || stored === THEME.DARK ? stored : null;
  } catch {
    return null; // приватный режим — просто работаем без сохранения
  }
}

/** Системная тема как значение по умолчанию для тех, кто ничего не выбирал. */
function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? THEME.LIGHT : THEME.DARK;
}

export function currentTheme() {
  return read() ?? systemTheme();
}

export function applyTheme(theme = currentTheme()) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  for (const listener of listeners) listener(theme);
  return theme;
}

export function setTheme(theme) {
  const next = theme === THEME.LIGHT ? THEME.LIGHT : THEME.DARK;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* сохранять некуда — тема продержится до перезагрузки */
  }
  return applyTheme(next);
}

export function toggleTheme() {
  return setTheme(currentTheme() === THEME.DARK ? THEME.LIGHT : THEME.DARK);
}

export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function themeLabel(theme = currentTheme()) {
  return THEMES.find((item) => item.id === theme)?.label ?? '';
}

export { THEME, THEMES };
