# iCooler

Платформа IoT для кулеров COOLTOUCH: прошивка платы связи, приём данных, команды, порталы.
ТЗ — [`doc/STAGE1_SPEC.md`](doc/STAGE1_SPEC.md); сервисы — §3.1, дорожки и папки — §6.3.

## Папки

| Папка | Что | Дорожка |
|---|---|---|
| [`doc/`](doc/README.md) | документация проекта | — |
| `contracts/` (PR #44) | общие контракты: JSON Schema сообщений §7.3, OpenAPI, объекты БД между дорожками; меняется с одобрения обеих дорожек | обе |
| [`firmware/`](firmware/) | прошивка платы связи (ESP-IDF, ESP32-C3) | Устройство |
| [`firmware_old/`](firmware_old/) | исходный код существующей прошивки кулера | — |
| [`simulator/`](simulator/) | симулятор кулеров по контрактам | Устройство |
| [`services/ingest`](services/ingest/) | приём из IoT Hub | Устройство |
| [`services/dispatcher`](services/dispatcher/) | очередь и доставка команд | Устройство |
| [`services/provisioning`](services/provisioning/) | сертификаты и DPS | Устройство |
| [`jobs/telemetry`](jobs/telemetry/) | плановые задачи телеметрии | Устройство |
| [`infra/iot`](infra/iot/) | Terraform: IoT Hub, DPS, TimescaleDB | Устройство |
| [`services/api`](services/api/) | API порталов | Платформа |
| [`web/operator`](web/operator/), [`web/enduser`](web/enduser/) | порталы оператора и End User | Платформа |
| [`jobs/app`](jobs/app/) | плановые задачи бизнес-части | Платформа |
| [`infra/core`](infra/core/) | Terraform: сеть, Container Apps, PostgreSQL, Redis, Key Vault, Application Gateway | Платформа |

## Сборка

Node.js 24, pnpm (версия — в `packageManager` корневого `package.json`, ставится через `corepack enable`).

```
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Скрипты корня запускают одноимённые скрипты всех пакетов workspace (`services/*`, `jobs/*`, `web/*`, `simulator`).
`firmware/` собирается средствами ESP-IDF; `contracts/` (появится с PR #44) проверяется своим тестом
(`cd contracts && npm test`). CI — `.github/workflows/ci.yml`. Пока в пакетах нет кода и скриптов, CI проверяет
только установку workspace; сборка, тесты и линтер подключаются вместе с кодом каждого пакета.
