# Контракты сообщений устройства (v0)

JSON Schema (draft 2020-12) для сообщений между кулером и платформой по ТЗ Stage 1 §7.3
([`doc/STAGE1_SPEC.md`](../doc/STAGE1_SPEC.md)). Действуют до спецификации PRT; версия payload — `v: 0`.
По этим схемам проверяют свои сообщения `simulator`, `ingest`, `dispatcher` и прошивка.
Владелец — дорожка «Устройство»; изменения — с одобрения обеих дорожек (§6.3).

| Схема | Направление | Когда |
|---|---|---|
| [`frame`](schemas/frame.schema.json) | устройство → платформа | кадр раз в 5 мин; внеочередной по `GET all` — с `cmd_id` |
| [`event`](schemas/event.schema.json) | устройство → платформа | по факту; `data` своя у каждого `type` |
| [`heartbeat`](schemas/heartbeat.schema.json) | устройство → платформа | раз в 60 с |
| [`hello`](schemas/hello.schema.json) | устройство → платформа | после старта и подключения |
| [`command`](schemas/command.schema.json) | платформа → устройство | команды Stage 1, закрытый список |
| [`command-ack`](schemas/command-ack.schema.json) | устройство → платформа | сразу после приёма команды |
| [`command-result`](schemas/command-result.schema.json) | устройство → платформа | итог команды: `code` 200/400 |
| [`common`](schemas/common.schema.json) | — | общие определения |

## Проверка

```
cd contracts
npm install
npm test
```

- каждая схема компилируется в строгом режиме ajv;
- правильные примеры (`examples/valid`) проходят схему и смысловые проверки
  [`scripts/semantics.mjs`](scripts/semantics.mjs) (расписание, часовой пояс по списку tzdb [`data/iana-timezones.json`](data/iana-timezones.json), существующая дата в `local:<время>`);
- неправильные (`examples/invalid`) отклоняются, и каждый **изолирован**: в
  [`examples/invalid.expect.json`](examples/invalid.expect.json) указан правильный базовый пример и поля, которыми
  неправильный от него отличается; других отличий быть не должно — значит, отклонён именно по ним;
- **покрытие**: у каждой команды Stage 1 (с каждым значением), каждого типа события и вида результата есть
  правильный пример, у запрещённых команд (`pin`, `serial`, `datetime`, `factoryreset`) — неправильный.

Пример относится к схеме по префиксу имени файла: `<схема>--<случай>.json`. CI — `.github/workflows/contracts.yml`.

## Решения, которых нет в ТЗ (на согласование)

1. **Тип сообщения устройства** передаётся свойством сообщения IoT Hub `mt`, а не полем в JSON:
   `frame`, `event`, `heartbeat`, `hello`, `ack`, `result`. Так тела сообщений остаются ровно в форме §7.3,
   а `ingest` выбирает схему без угадывания по полям.
2. **CRC32** в `schedversion` — 8 шестнадцатеричных цифр в нижнем регистре: `17,9a0f1c2b`.
3. **Причины `reboot`:** `power`, `watchdog`, `update` по ТЗ и `other` — прочие причины сброса ESP32 (паника, просадка питания).
4. **Коды ошибок:** `B1`–`B3` — биты платы; коды контроллера — с префиксом `C` (`C17`), справочник — RE-4.
5. **`hello.model`:** `water_source` (`bottle_top` / `bottle_bottom` / `mains` — U/D/N в имени BLE), `variant` (A/S),
   `carbonated`; `build` — код сборки существующей прошивки, если известен.
6. **`deadline_at`** — UTC: суффикс `Z` или `+00:00`.
7. **`local:<время>`** в версии расписания — ISO-8601 с проверкой диапазонов месяца, дня, часа, минут и смещения.
8. **Ответ на `GET`** с `param` и `value` — только для `schedversion`, `timezone`, `otaallowed`; `GET all` отвечает
   `{code: 200}`, данные — во внеочередном кадре.
9. **`bottle_installed`:** `data.liters_since_last`. **`buffer_overflow`:** `data.frames_lost`, `data.events_lost`.
10. **`selftest`:** имена проверок свободные (`[a-z0-9_]`), значения `ok` / `fail`.
11. **`cmd_id`:** 1–64 символа `[A-Za-z0-9_-]`; **`device_id`:** 1–128 символов, как разрешает IoT Hub.

Температуры и поля связи — без диапазонов и без `null` у полей связи, строго по таблице §7.3: кадр
с выходом температуры за привычные значения не должен теряться.

Смысловые правила расписания (одно окно на день, уникальные номера выходных, начало < конца) и часовой пояс IANA
проверяет [`scripts/semantics.mjs`](scripts/semantics.mjs) — те же правила обязаны соблюдать `dispatcher`, `ingest`
и прошивка. Чего не проверяет ни схема, ни тест (делает код): наличие `applied` в результате `hottank`/`coldtank`/`power` (в результате `POST` нет параметра — сверяет `dispatcher`
по команде); монотонность `seq` и `water_total_l`.
