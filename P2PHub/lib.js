// lib.js — «чистые» функции без DOM и сети.
// Вынесены отдельно, чтобы их можно было покрыть тестами
// (см. tests/). Используется и в браузере (app.js), и в тестах.

// Человекочитаемый размер: 2048 -> "2.0 КБ".
export function fmtBytes(n) {
  if (!n || n < 0) return "0 Б";
  const u = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(1) + " " + u[i];
}

// Экранирование текста перед вставкой в HTML (защита от инъекций в чате).
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Проверка, что строка похожа на корректную magnet-ссылку.
export function isMagnetUri(s) {
  return /^magnet:\?xt=urn:btih:[a-z0-9]+/i.test((s || "").trim());
}

// Сколько последних сообщений храним в истории чата.
export const MAX_HISTORY = 200;

// Обрезаем историю до последних MAX_HISTORY записей.
export function trimHistory(list) {
  return Array.isArray(list) ? list.slice(-MAX_HISTORY) : [];
}

// Безопасный разбор истории из строки localStorage.
export function parseHistory(raw) {
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
