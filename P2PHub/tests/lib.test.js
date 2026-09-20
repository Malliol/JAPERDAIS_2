// tests/lib.test.js — запуск общих тест-кейсов через встроенный
// тест-раннер Node (без сторонних зависимостей):
//
//     node --test
//
// Используется в GitHub Actions (там Node есть). Локально без Node
// можно открыть tests/run.html в браузере.

import { test } from "node:test";
import { cases } from "./cases.js";

for (const c of cases) {
  test(c.name, () => c.fn());
}
