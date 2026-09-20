// tests/cases.js — общий список тест-кейсов для чистых функций из lib.js.
// Используется и браузерным раннером (run.html), и Node (lib.test.js),
// чтобы не дублировать тесты.

import {
  fmtBytes,
  escapeHtml,
  isMagnetUri,
  trimHistory,
  parseHistory,
  MAX_HISTORY,
} from "../lib.js";

// Мини-проверки (бросают ошибку при несовпадении).
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + ": " : "") + `ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}
function jsonEq(actual, expected, msg) {
  eq(JSON.stringify(actual), JSON.stringify(expected), msg);
}

export const cases = [
  // ---- fmtBytes ----
  { name: "fmtBytes: ноль", fn: () => eq(fmtBytes(0), "0 Б") },
  { name: "fmtBytes: байты", fn: () => eq(fmtBytes(512), "512.0 Б") },
  { name: "fmtBytes: килобайты", fn: () => eq(fmtBytes(2048), "2.0 КБ") },
  { name: "fmtBytes: мегабайты", fn: () => eq(fmtBytes(1048576), "1.0 МБ") },
  { name: "fmtBytes: отрицательное -> 0 Б", fn: () => eq(fmtBytes(-5), "0 Б") },

  // ---- escapeHtml ----
  { name: "escapeHtml: теги", fn: () => eq(escapeHtml("<b>"), "&lt;b&gt;") },
  { name: "escapeHtml: спецсимволы", fn: () => eq(escapeHtml("a&b\"c'"), "a&amp;b&quot;c&#39;") },
  { name: "escapeHtml: обычный текст без изменений", fn: () => eq(escapeHtml("привет"), "привет") },

  // ---- isMagnetUri ----
  { name: "isMagnetUri: корректная", fn: () => eq(isMagnetUri("magnet:?xt=urn:btih:abcdef0123"), true) },
  { name: "isMagnetUri: с пробелами и верхним регистром", fn: () => eq(isMagnetUri("  magnet:?xt=urn:btih:ABC123  "), true) },
  { name: "isMagnetUri: обычная ссылка -> false", fn: () => eq(isMagnetUri("http://example.com"), false) },
  { name: "isMagnetUri: пустая строка -> false", fn: () => eq(isMagnetUri(""), false) },
  { name: "isMagnetUri: null -> false", fn: () => eq(isMagnetUri(null), false) },

  // ---- trimHistory ----
  {
    name: "trimHistory: обрезает до MAX_HISTORY",
    fn: () => {
      const big = Array.from({ length: MAX_HISTORY + 50 }, (_, i) => i);
      const out = trimHistory(big);
      eq(out.length, MAX_HISTORY, "длина");
      eq(out[out.length - 1], MAX_HISTORY + 49, "последний элемент сохранён");
    },
  },
  { name: "trimHistory: короткий список не меняется", fn: () => jsonEq(trimHistory([1, 2, 3]), [1, 2, 3]) },
  { name: "trimHistory: не массив -> []", fn: () => jsonEq(trimHistory("nope"), []) },

  // ---- parseHistory ----
  { name: "parseHistory: валидный JSON-массив", fn: () => jsonEq(parseHistory('[{"a":1}]'), [{ a: 1 }]) },
  { name: "parseHistory: мусор -> []", fn: () => jsonEq(parseHistory("garbage"), []) },
  { name: "parseHistory: null -> []", fn: () => jsonEq(parseHistory(null), []) },
  { name: "parseHistory: объект (не массив) -> []", fn: () => jsonEq(parseHistory('{"x":1}'), []) },
];
