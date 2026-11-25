# Proposal HYD-SIG-2026-01 — правки к версии 1.3

**Основа:** `docs/EN — Hydracom_Proposal_HYD-SIG-2026-01_COOLTOUCH_SIG_IoT_platform_v1.2.docx`
(внутри документа стоит «Version 1.1»), ТЗ v2.0.
**Дата:** 2026-11-21

Каждая правка: **где** → **сейчас** (дословная цитата из v1.2; ячейки таблиц — через « | ») → **предлагаемый текст** (на английском, готов к вставке) → **почему**.
Где нужно выбрать вариант, стоит **[выбрать]**. Цифры, которых в v1.2 нет (цена, ставки), оставлены как `[…]`.

---

## A. Прошивка платы связи — главная правка

Сейчас Proposal исходит из того, что прошивку устройства пишет SIG, а у Hydracom только MQTT.
По факту SIG передаёт устройство с платой связи, и прошивку этой платы пишет Hydracom.
Правки A-1…A-8 нужно вносить вместе, иначе документ будет противоречить сам себе.

**A-1. §1.1, второй пункт зависимостей**
- Сейчас: «SIG firmware with LTE connectivity on 10 test devices»
- Предлагается: «Delivery of the 10 test devices for the pilot (cooler with communication board); the first device is already available. The communication board firmware is developed by Hydracom SIA (Section 2.3).»
- Почему: прошивка больше не зависимость от SIG, зависимость — только устройства.

**A-2. §2.3 In scope — заменить строку**
- Сейчас: «MQTT protocol development and integration on SIG firmware (mutually agreed)»
- Предлагается:
  «Firmware of the device communication board: LTE connectivity, TLS with per-device X.509 certificates, MQTT, the device protocol, buffering during connectivity loss, the link to the cooler controller, local schedule execution, and a bootloader with over-the-air update and rollback»
  «Analysis of the device, of the existing communication board firmware and of its Bluetooth protocol, to extend the command set, including service commands, and to compile the error code directory»
- Почему: это реальный объём работ; без него он не оплачен и не защищён сроками.

**A-3. §2.3 In scope — изменить строку**
- Сейчас: «Joint development of the device communication protocol specification with SIG»
- Предлагается: «Development of the device communication protocol specification by Hydracom SIA, extending the existing protocol of the communication board, and its agreement with SIG»
- Почему: протокол уже есть в существующей прошивке платы (передан SIG), мы его расширяем, а не пишем с нуля.

**A-4. §2.4 Out of scope — строка «Device firmware development»**
- Сейчас: «The device firmware (excluding MQTT) is developed by SIG. Our scope is the cloud-side adapter, the protocol specification and joint integration testing.»
- Предлагается: «Cooler controller firmware — The firmware of the cooler controller (heating, cooling, pasteurisation, sensors, safety interlocks) remains with SIG and is not modified. The communication board firmware is in scope (Section 2.3).»

**A-5. §2.5, строка ответов № 1, 5 — колонка «Effect on this proposal»**
- Сейчас: «Removes firmware development from our scope, except MQTT integration (see Section 2.3), but moves the critical path to the SIG side.»
- Предлагается: «Superseded by Section 2.6, item 9: the communication board firmware is developed by Hydracom SIA; the cooler controller firmware remains with SIG.»
- Почему: сам ответ SIG не переписываем, меняем только вывод из него.

**A-6. §2.6 — добавить пункт 9**
- Предлагается: «9 | Communication board firmware: SIG supplies the device with its communication board; Hydracom SIA develops the communication board firmware (Section 2.3). The cooler controller firmware remains with SIG. | Extends V-031 (key deliverable of the specification), V-032, V-034. Stage 1»

**A-7. §3.1 Confirmed information**
- Строка «Ownership of device firmware | SIG» → «Device firmware — Cooler controller: SIG. Communication board: developed by Hydracom SIA, rights transferred per Section 7.1.»
- Строка «Hardware error code documentation | Exists (current documentation); connectivity error codes do not exist and will be defined in this project» → «Error code directory — Compiled in this project from the device and the existing application, including connectivity error codes; existing SIG documentation, where available, is used as input.»
- Добавить строку: «Over-the-air firmware update | Supported by the device. Implemented in the communication board firmware and disabled by default; enabled per device only on SIG's decision»
- Добавить строку: «Communication board | ESP32-C3-based; the existing firmware source and command table are provided by SIG and used as the starting point»

**A-8. §6.3 Not included**
- Сейчас: «Device firmware development and maintenance — SIG scope per response no. 5»
- Предлагается **[выбрать]**:
  - (а) «Cooler controller firmware — SIG scope. Maintenance of the communication board firmware after handover is included in item 5 of Section 6.1.»
  - (б) «Cooler controller firmware — SIG scope. Maintenance of the communication board firmware after handover is estimated separately.»

**A-9. §4.5 Device communication and protocol — первый абзац**
- Сейчас: «Hydracom SIA develops it jointly with SIG as the first deliverable of the project.»
- Предлагается: «Hydracom SIA develops it from the analysis of the device and agrees it with SIG as the first deliverable of the project. On the device side, the communication board firmware implements the protocol, buffers telemetry and events during connectivity loss (up to 72 hours), executes operating schedules locally and supports over-the-air update with rollback, disabled by default and enabled on SIG's decision.»

**A-10. A-06 — убрать допущение, OTA подтверждено**
- Сейчас: «The device module and bootloader support over-the-air firmware updates.»; последствие: «This was not confirmed in response no. 5 and is carried as an open item to be confirmed before contract signature.» и «If the hardware does not support OTA, requirement S-010 cannot be delivered and is removed from Stage 2.»
- Предлагается: удалить A-06 (перенесено в §3.1, правка A-7). Номер A-06 оставить пустым «— (moved to Section 3.1)», чтобы не сдвигать ссылки.

---

## B. Обещано то, что исключено

**B-1. §2.2, строка «SIG manufacturer portal», колонка Purpose**
- Сейчас: «Global device registry, digital passport, firmware and OTA management, quality and RMA, product analytics, certificate lifecycle»
- Предлагается: «Global device registry, digital passport, firmware and OTA management, configuration templates, engineering logs including device error reports (S-001…S-014). Quality, RMA, product analytics and certificate lifecycle management (S-018…S-037) are outside the current scope (Section 2.4); individual functions can be added by agreement as a change request with a separate estimate.»
- Почему: RMA, качество, аналитика (S-019…S-031) и управление сертификатами из портала SIG (S-034) исключены в §2.4, но обещаны здесь. Формулировка «future phase» не обещает и не исключает их навсегда: отдельные функции можно добавить по запросу. Отчёты об ошибках устройств SIG получает уже сейчас — через журналы S-013.

**B-2. §4.8, строка «Security monitoring»**
- Сейчас: «Unauthorised connection attempts, repeated authentication failures and anomalous command patterns raise security events.»
- Предлагается: «Unauthorised connection attempts, repeated authentication failures and anomalous command patterns are recorded in the audit log and raise platform alerts to administrators. A dedicated security events module (S-035) is a future phase.»

**B-3. §4.9, второй абзац**
- Сейчас: «…whose visibility is configured through data access policy — raw technical, aggregated or anonymised data — rather than granted in full.»
- Предлагается: «…whose access is limited to authorised technical and aggregated data (S-003) rather than granted in full. A configurable data access policy (S-036) is a future phase.»

**B-4. §2.3 и §5.2 — E2E-09**
- Сейчас (§2.3): «End-to-end scenarios E2E-01…E2E-10, except E2E-05 (removed, see Section 2.6)»
- Предлагается: «End-to-end scenarios E2E-01…E2E-10, except E2E-05 (removed, see Section 2.6) and E2E-09 (requires RMA and quality analytics, S-020, S-022, S-027 — future phase)»
- В §5.2 «The scenarios E2E-01…E2E-10 of the specification (except E2E-05)» → «(except E2E-05 and E2E-09)».

**B-5. Число требований — титульная страница и §1**
- Сейчас: «This proposal covers 95 of the 110 numbered functional requirements of Technical Specification v2.0; S-018…S-037 are out of scope (see Section 2.4).» и «All 95 in-scope numbered requirements»
- Предлагается: «This proposal covers 94 of the 110 numbered functional requirements of Technical Specification v2.0; S-018…S-037 are out of scope (see Section 2.4) and V-102 is removed by agreement (Section 2.6).» и «All 94 in-scope numbered requirements … are included; V-065, V-076, V-077, V-079, V-103 and V-104 are delivered in changed form (Section 2.6).»
- Почему: 110 − 15 (S-018…S-037) − 1 (V-102) = 94.

---

## C. Этапы и eSIM/LTE

**C-1. §1, таблица этапов**
- Сейчас: ячейки «Stage 2 (partial)» и «Stage 3 | MVP-2 LTE management | On demand»
- Предлагается:
  - «Stage 2» — без «(partial)».
  - Stage 3: «Scale-out beyond the warranted capacity (Section 4.6) | On demand».
  - Под таблицей: «eSIM/LTE requirements by stage: Stage 1 — C-001, C-002, C-014 and the manual workflow of C-015 (pilot); Stage 2 — C-003…C-013 and the provider API of C-015.»
- Почему: в ТЗ нет «MVP-2 LTE management»; без таблицы непонятно, какие C-пункты когда сдаются, а заголовок «delivered in full» с «partial» и «on demand» читается против нас.

**C-2. §1.1 — последняя фраза**
- Сейчас: «The dates for these deliverables will be agreed with SIG at project kick-off.»
- Предлагается: «The dates for these deliverables will be agreed with SIG at project kick-off. A delay in any of them shifts the pilot date and the full implementation date by the same number of days.»

**C-3. A-04**
- Сейчас: «The pilot on 1 March 2027 is conducted on the ten test devices confirmed in response no. 6.»
- Предлагается: «The pilot on 1 March 2027 is conducted on ten test devices. The first device is already available; the remaining nine are delivered by 31 January 2027.» Последствие: «If fewer devices are delivered, the pilot is conducted and accepted on the number delivered; a later delivery shifts the pilot date (Section 1.1).»
- И в §3.1 строка «Test devices | SIG provides up to 10 units, available as required» → «SIG provides 10 units for the pilot (see A-04).»
- Почему: «up to 10» позволяет дать меньше, а пилот везде записан ровно на 10.

**C-4. Stage 4 и гарантия (§1, §2.6 п. 8, §6.4, A-15)**
- Сейчас: Stage 4 — «Within one month after final acceptance»; §6.4 — «A twelve-month warranty period follows final acceptance.»
- Предлагается в §6.4: «A twelve-month warranty period starts at final acceptance of Stage 2. The consumer instruction (Stage 4) is accepted separately under A-15.»

---

## D. Приёмка

**D-1. Новый раздел §2.7 «Acceptance criteria»**
- Предлагается:
  «Section 14 of the specification applies as amended by Sections 2.4 and 2.6:
  — Commands: pasteurisation start and temperature setpoints are replaced by heating on/off and cooling on/off;
  — Water counters: total water consumption, aggregated over a period, replaces four separate water types;
  — SIG portal: quality/RMA is out of scope;
  — eSIM/LTE: per the stage table in Section 1.
  Pilot acceptance (Stage 1): the pilot devices (ten, or the number delivered under A-04) run the delivered communication board firmware and transmit heartbeat and telemetry over LTE for seven consecutive days with no more than 1 % of frames missing; devices recover automatically after power loss and connectivity loss and deliver buffered data; a request for current data returns within 30 seconds for an online device; Stage 1 commands are delivered, executed and logged with their result; alerts are raised per the agreed rules; End Users see and control only their own coolers; scenarios E2E-01, 02, 03, 04, 06 and 07 pass on real devices.»
- Почему: сейчас при приёмке будут проверять по разделу 14 ТЗ — с пастеризацией, уставками и четырьмя типами воды.

**D-2. §2.3 — добавить результат работ**
- Предлагается: «Test results and pilot launch report on real devices (Section 13 of the specification)»

**D-3. Время ответа — §4.5 или §5.2**
- Предлагается: «Response times of Section 12 of the specification — on-demand request ≤ 30 s and command ≤ 30 s for an online device — are measured during the pilot. Delays caused by the mobile network outside the platform are reported separately.»

**D-4. A-15**
- Сейчас: «Acceptance of each milestone is completed within ten business days of delivery.» и «Longer acceptance cycles extend the schedule and are treated as customer-side delay.»
- Предлагается: «Acceptance of each milestone is signed by SIG within ten business days of delivery; VENDEN takes part in user acceptance testing. Defects that block acceptance are reported in writing within this period; Hydracom SIA corrects them and the corrected delivery is re-tested within five business days. Absence of written objections within the period counts as acceptance.» Последствие: «Longer acceptance cycles extend the schedule and are treated as customer-side delay. The time from a written defect report to the delivery of the corrected version, and the re-test period that follows, are not customer-side delay. Defects found during a re-test follow the same procedure.»
- Почему: иначе обоснованный отказ в приёмке из-за дефекта считается задержкой заказчика.

---

## E. Новые допущения (A-16…A-27)

Решения, которые раньше были вопросами к SIG. Записываются как допущения: SIG либо соглашается, либо возражает по пункту.

| ID | Assumption | Consequence if it does not hold |
|---|---|---|
| A-16 | End User accounts are created by the operator (VENDEN) by e-mail invitation; there is no self-registration. An End User is linked to a client and sees all coolers of that client; a client may have several End Users. | Self-registration or device-level linking is a change request. |
| A-17 | End Users may reset the filter resource and the consumption counter with double confirmation. The device water counter is cumulative and is never reset; a consumption reset sets a reference point on the platform. The operator sees every reset in the device log. | Operator approval of resets is a change request. |
| A-18 | The device reports one cumulative total water counter. If the device also reports liters by water type, they are stored for analytics; all user interfaces show total consumption only (Section 2.6, item 2). | Showing water types in the interface is a change request. |
| A-19 | Operating schedules are stored on the platform and executed locally by the communication board firmware, so they work without connectivity. | — |
| A-20 | Default thresholds (offline time, water temperature limits, filter warning levels) are set by Hydracom SIA in the working specification and are editable in platform settings by the operator. | — |
| A-21 | The permission matrix for the VENDEN roles and End User is defined in the working specification and delivered with the technical documentation. Changes after the start of Stage 1 follow Section 7.3. | — |
| A-22 | Reports are exported in CSV and XLSX; PDF export (V-081, "if required") is not included. | PDF export is a change request. |
| A-23 | The customer demo (01-Fleet-Dashboard.html) is a visual reference; functional scope is defined by this proposal. | — |
| A-24 | Bluetooth remains on the device; the current application and technicians' on-site access keep working with the new communication board firmware. | Removing Bluetooth reduces scope. |
| A-25 | The English interface texts of the End User portal are part of the delivered software; SIG/VENDEN provide the Latvian, Russian, Estonian and Lithuanian translations, and any customer-facing wording they want to change, by 31 January 2027. | Late translations delay acceptance of the affected languages only. |
| A-26 | For the pilot, device certificates are written by Hydracom SIA on its test bench. Certificate provisioning in series production at the SIG factory is not included. | Factory provisioning is a change request. |
| A-27 | The cooler controller reports pasteurisation start, end, result and errors over its interface to the communication board. The existing interface does not carry these signals; if the device analysis confirms they are absent, SIG adds them to the cooler controller firmware. | Until then, the pasteurisation log, KPI and alerts (V-064, V-092, V-093, V-118) cannot be delivered and are accepted after SIG provides the signals. |

**E-1. A-08 — дописать:** «Domain names for the portals and the sender address for account e-mails are provided by SIG by 15 January 2027.»

**E-2. A-09 — колонка последствий**
- Сейчас: «Confirmation requested from SIG before Stage 2 starts.»
- Предлагается: «Onboarding an operator that requires development (for example, a different device type or protocol) is a change request.»
- Почему: в колонке последствий стоит не последствие.

---

## F. Архитектура и безопасность

**F-1. §4.3 и D-04 (§4.4) — Front Door и граница ЕС**
- Сейчас: §4.3 — «Keeps all traffic within the Azure EU boundary — see decision D-04»; D-04 — «Front Door was chosen over a third-party edge service for one reason: all traffic, including TLS termination, stays within the Azure EU boundary.» и «these are internal operator portals used by dozens of people, not a public high-traffic site.»
- Почему: Front Door — глобальный сервис: TLS снимается и запросы обрабатываются на ближайшем edge-узле, он может быть вне ЕС. ТЗ §12 требует серверы в ЕС.
- Предлагается **[выбрать]**:
  - (а) Оставить Front Door, честно описать: §4.3 → «Global edge with WAF in front of the user portals — see decision D-04»; D-04 → «Front Door is a global service: user HTTP traffic is decrypted and inspected at Microsoft edge locations, which may be outside the EU. All data is stored and all application processing takes place in the Azure EU region; device traffic does not pass through Front Door.» Требует согласия SIG с обработкой трафика на edge вне ЕС.
  - (б) Всё внутри ЕС: заменить Front Door на Azure Application Gateway с WAF в регионе ЕС. §4.3 → «Keeps all user traffic, including TLS termination, within the Azure EU region — see decision D-04»; D-04 переписать под Application Gateway (WAF, rate limiting, bot protection — те же функции, без глобального edge). Меняется стоимость в A-03.
- В обоих вариантах фразу «internal operator portals used by dozens of people, not a public high-traffic site» заменить: «The operator and SIG portals are used by a limited number of people; the End User portal is public and is protected by rate limiting, bot protection and brute-force protection.»

**F-2. A-14**
- Сейчас: «Azure DDoS Protection Standard is not included; the solution is closed to external access, with platform-level protection and Front Door edge protection applied to externally reachable services.»
- Предлагается: «Azure DDoS Protection Standard is not included; the operator and SIG portals are restricted to authenticated users, the public End User portal is protected by WAF rate limiting and bot protection, and platform-level protection applies to all externally reachable services.»

**F-3. §4.8, строка «Device identity» — выпуск, ротация, отзыв**
- Сейчас: «X.509 certificates per device, issued through the Device Provisioning Service.» и «Certificate issuance, rotation and revocation are handled through the Device Provisioning Service; certificate management in the SIG portal is planned for a future phase.»
- Предлагается: «X.509 certificates per device, issued by the platform certificate authority. Each device has an individual enrolment in the Device Provisioning Service; group enrolments are not used. For the pilot, certificates are written to the devices on the test bench (A-26). Rotation: before expiry the platform issues a new certificate and adds it to the device's individual enrolment as the secondary certificate; the communication board firmware receives it over the authenticated connection, re-provisions through the Device Provisioning Service with the new certificate, and the old certificate is then removed from the enrolment. Revocation: the device's individual enrolment is disabled (not deleted) and the device is disabled in IoT Hub, so a revoked device can neither stay connected nor re-register. Certificate management in the SIG portal (S-034) is a future phase.»
- Почему: удаление записи в DPS не отключает устройство, уже зарегистрированное в IoT Hub, а при групповой регистрации не мешает зарегистрироваться повторно; ротация как процесс не описана.

**F-4. §4.7 и A-11 — хранение сырых данных**
- Сейчас: A-11 — «Raw telemetry is retained for 180 days, hourly aggregates for three years and daily aggregates for the full ten-year period. Water counter values are retained indefinitely.»; §4.7, строка «Cold | 3 to 10+ years | Daily aggregates and exported raw data in Parquet format | Azure Blob with lifecycle policy to Cool and Archive».
- Почему: два раздела обещают разное; ТЗ §12 требует «Telemetry and logs for at least 10 years».
- Предлагается **[выбрать]** (рекомендуется (а) — прямо выполняет ТЗ §12):
  - (а) Архив сырых данных на 10 лет. A-11 → «Raw telemetry is retained online for 180 days and then archived in Parquet format in Azure Blob storage (Archive tier) for ten years; archived data is restored on request. Hourly aggregates are retained for three years and daily aggregates for ten years. Water counter values are retained indefinitely.» §4.7: добавить строку «Archive | 180 days to 10+ years | Raw telemetry in Parquet format | Azure Blob, Archive tier»; строка Cold → «3 to 10+ years | Daily aggregates | TimescaleDB / Azure Blob». Последствие A-11 → «Keeping full-resolution telemetry online in TimescaleDB for ten years instead of archiving it increases storage costs approximately [×N — пересчитать].» Это расширение объёма относительно рабочего ТЗ (V-036: сырые данные 180 дней): архивирование и восстановление по запросу — новые работы, при выборе (а) V-036 дополняется.
  - (б) Без архива сырых данных. §4.7 Cold → «3 to 10+ years | Daily aggregates | Azure Blob with lifecycle policy to Cool and Archive»; в A-11 дописать: «Raw telemetry older than 180 days is not retained; the ten-year retention of Section 12 of the specification is met by hourly and daily aggregates.» Требует согласия SIG с таким толкованием ТЗ §12.

**F-5. D-01 и §4.6 — основа расчёта объёма**
- Сейчас: D-01 — «the difference between roughly 210 GB and roughly 1.2 TB of stored telemetry at a 50,000-device fleet»; §4.6, строка «Telemetry accumulated over 10 years | n/a | ~8.5 GB | ~210 GB».
- Почему: не сказано, при какой политике хранения и сжатии посчитаны 8,5 GB и 210 GB; при 216 млн точек в сутки за 10 лет набегает около 790 млрд точек, такой объём в 210 GB помещается только при хранении по A-11, а не при полном разрешении.
- Предлагается: в строке §4.6 → «Telemetry accumulated over 10 years (retention per A-11, compressed)» и пересчитать значения под вариант, выбранный в F-4; в D-01 — «…roughly [X] GB with columnar compression and roughly [Y] TB without it, at a 50,000-device fleet and the retention policy of A-11.» — значения X, Y и множитель в A-11 пересчитываются один раз под выбранный вариант F-4 и подставляются во все три места (D-01, A-11, таблица §4.6).

**F-6. Ёмкость на старте — §1, §2.5, §4.6, §5.2**
- Почему: ТЗ §4 — «Number of devices at launch: more than 2,000 coolers»; гарантия ровно на 2 000 оставляет часть стартового парка вне гарантии.
- Предлагается: принять гарантируемую ёмкость **3 000 устройств** и заменить во всех местах:

| Где | Сейчас | Предлагается |
|---|---|---|
| §1 | «Designed for 50,000 devices. Sized for 2,000. Scale-out to 50,000 is an option.» | «Designed for 50,000 devices. Sized for 3,000, covering the launch fleet of more than 2,000. Scale-out to 50,000 is an option.» |
| §2.5, ответ 9 | «architecture for 50,000, sizing for 2,000, scale-out on demand (TBD)» | «architecture for 50,000, sizing for 3,000, scale-out on demand (TBD)» |
| §4.6, текст | «The infrastructure delivered in Stage 2 is sized, load-tested and warranted for 2,000 devices; the architecture is ready for 50,000.» | «The infrastructure delivered in Stage 2 is sized, load-tested and warranted for 3,000 devices, covering the launch fleet of more than 2,000 devices (Section 4 of the specification); the architecture is ready for 50,000.» |
| §4.6, таблица — заголовок колонки | «2,000 devices» | «3,000 devices» |
| §4.6, таблица — Telemetry frames per second | «~6.7 average, ~20 peak» | «~10 average, ~30 peak» |
| §4.6, таблица — Data points per day | «8.6 million» | «13 million» |
| §4.6, таблица — Telemetry accumulated over 10 years | «~8.5 GB» | пересчитать вместе с F-5 (при той же основе — ~12.8 GB) |
| §5.2, Load and capacity | «Synthetic fleet of 2,000 devices, measuring ingestion rate, query latency, command throughput and alert processing» | «Synthetic fleet of 3,000 devices (sizing and warranty) and a capability test with 10,000 synthetic devices (Appendix B of the specification), measuring ingestion rate, query latency, command throughput and alert processing» |

Расчёт: 3 000 устройств × 288 кадров в сутки = 864 000 кадров ≈ 10 в секунду; × 15 параметров ≈ 13 млн точек в сутки.
Если оставить 2 000 — во всех местах дописать «the launch fleet above 2,000 devices is covered by scale-out (Stage 3)».

**F-7. §5.2 Testing with real hardware**
- Сейчас: «Several physical test devices, covering connectivity, telemetry accuracy, command delivery and error conditions»
- Предлагается дописать: «…on a remote test bench next to the device, including power loss, connectivity loss and over-the-air update with rollback.»

---

## G. Поддержка и коммерция

**G-1. §6.1 и §6.4 — часы поддержки и граница с гарантией**
- Сейчас: строка «Total | 13 hours plus standby»; «On-call readiness — item 2. This is availability, not hours. Work performed during an incident is drawn from item 5.»
- Предлагается: «Total | 13 hours per month plus standby». После таблицы: «Unused hours [are not carried over / are carried over to the next month — выбрать]. Work on a P1 incident continues until resolution regardless of the remaining hours; hours above the monthly allowance are billed at [rate] per hour. Correction of defects in the delivered work during the warranty period (Section 6.4) does not consume the included hours.»
- Почему: сейчас не указан период, и неясно, что происходит, когда часы кончаются, а также расходуют ли их гарантийные исправления.

**G-2. §6.2 — P1 и доступность**
- Сейчас: «…a one-hour response with an eight-hour resolution target for P1 incidents fits within that with margin.»
- Предлагается: P1 Resolution target «4 hours»; текст: «A target of 99 % permits approximately 7.2 hours of downtime per month; the P1 response of one hour and resolution target of four hours keep a single P1 incident within this budget.»
- Почему: 1 ч + 8 ч = 9 ч больше 7,2 ч — один инцидент P1 уже нарушает 99 %.

**G-3. §7 — добавить §7.4 «Price and payment terms»**
- Предлагается: «Stage 1: […] EUR; Stage 2: […] EUR; Stage 4: […] EUR; maintenance (Section 6): […] EUR per month; change requests: […] EUR per hour. Payment: [schedule]. Prices exclude VAT.» — или ссылка: «Price and payment terms are set out in a separate commercial offer dated […].»
- Почему: в разделе «Commercial terms» нет цены.

---

## H. Мелочи

| # | Где | Сейчас | Предлагается |
|---|---|---|---|
| H-1 | Титул, таблица | «Version 1.1» | «Version 1.3» (и имя файла `…_v1.3.docx`) |
| H-2 | Титул, первая строка | «Commercial Proposal No. HYDSIG202601» | «Commercial Proposal No. HYD-SIG-2026-01» |
| H-3 | Титул, Reference documents | «VENDEN_SIG_IoT_TZ_v2_0_EN.docx» | «VENDEN_SIG_IoT_TZ_v2.0_EN.docx» |
| H-4 | §2.6 п. 1 | «view water consumption without aggregation by day, week, month or custom period» | «view water consumption with aggregation by day, week, month or custom period» |
| H-5 | Титул, Date | «15 November 2026» | дата выпуска v1.3 |

---

## I. Упрощение инфраструктуры

Цель — меньше собственных серверов с состоянием, которые нужно поддерживать: вместо кластера AKS с тремя
самоуправляемыми сервисами (TimescaleDB, RabbitMQ, Redis Sentinel) — управляемые сервисы Azure и одна
самоуправляемая база телеметрии. Требования ТЗ и масштаб до 50 000 устройств не меняются. Правки I-1…I-9
вносятся вместе.

**I-1. §4.2, таблица слоёв — строка «Streaming and messaging»**
- Сейчас: «Event Hubs (Kafka endpoint), ingestion workers, RabbitMQ, Redis | High-volume telemetry stream; durable business messaging; hot state and coordination»
- Предлагается: «IoT Hub built-in endpoint, ingestion workers, PostgreSQL job queue, Azure Managed Redis | High-volume telemetry stream; durable command and job processing; hot state and coordination»

**I-2. §4.3, таблица стека**

| Строка | Сейчас | Предлагается |
|---|---|---|
| Time-series | «PostgreSQL with TimescaleDB Community, self-managed on AKS» | «PostgreSQL with TimescaleDB Community, self-managed on dedicated Azure virtual machines» |
| Cache and state | «Redis» | «Azure Managed Redis (managed)» |
| Message broker | «RabbitMQ 4.x» / «Command lifecycle with retries, timeouts and dead-letter queue; OTA campaign orchestration; external API calls» | строку переименовать в «Command and job queue»: «PostgreSQL-based job queue in the business database» / «Command lifecycle with retries, timeouts and dead-letter handling; OTA campaign orchestration; external API calls — without a separate broker to operate» |
| Telemetry stream | «Azure Event Hubs, consumed via the Azure Event Hubs SDK for Node.js» | «Built-in Event Hub-compatible endpoint of IoT Hub, consumed via the Azure Event Hubs SDK for Node.js; no separate Event Hubs namespace» |
| Infrastructure | «Azure EU region, Terraform, Docker, AKS» | «Azure EU region, Terraform, Docker, Azure Container Apps» |

**I-3. D-01 — где работает TimescaleDB**
- Сейчас: «Telemetry runs on a self-managed PostgreSQL cluster with the TimescaleDB Community edition on AKS, backed up with pgBackRest to Azure Blob.»
- Предлагается: «Telemetry runs on a self-managed PostgreSQL cluster with the TimescaleDB Community edition on two dedicated Azure virtual machines in different availability zones (primary and streaming replica), backed up with pgBackRest to Azure Blob.»
- Почему: база с состоянием на виртуальных машинах проще в эксплуатации, чем внутри Kubernetes; причина самоуправления (сжатие и непрерывные агрегаты есть только в Community-редакции) остаётся.

**I-4. D-02 и A-13 — Redis**
- Сейчас (D-02): «Redis is deployed self-managed on AKS with Sentinel high availability.» и «Redis is used unmodified, as a separate service reached over the network, and is not offered as a service to third parties. Application source code is therefore unaffected by its licence terms, which matters given the full transfer of rights. This is recorded in assumption A-13: migration to Valkey is available if preferred and amounts to roughly two days of change work.»
- Предлагается (D-02): «Redis is used as the managed Azure Managed Redis service with built-in high availability.» Второй абзац заменить: «As a managed Microsoft service, it raises no licence questions for the delivered source code. Azure Managed Redis is used rather than Azure Cache for Redis, which Microsoft no longer offers to new customers and is retiring.»
- A-13 → «— (not applicable: managed Azure Managed Redis, see D-02)», номер оставить, чтобы не сдвигать ссылки.

**I-5. D-03 — очередь команд и задач**
- Сейчас: заголовок «D-03. Message broker: RabbitMQ, self-managed»; текст «RabbitMQ 4.x runs as a three-node cluster with quorum queues, driven by NestJS worker services. It is responsible for the command lifecycle described by requirement V-037 — queueing, retries, timeouts, dead-lettering and the pending, sent, acknowledged, succeeded, failed and expired states — together with alert evaluation, aggregate recalculation, report exports, OTA campaign orchestration and calls to the eSIM provider API.»; «Considered as an alternative and rejected: Azure Service Bus — on cost at fleet scale and on portability.»
- Предлагается: заголовок «D-03. Command and job queue: PostgreSQL»; текст «Commands and background jobs are queued in the business database and processed by NestJS worker services. The queue is responsible for the command lifecycle described by requirement V-037 — queueing, retries, timeouts, dead-lettering and the pending, sent, acknowledged, succeeded, failed and expired states — together with alert evaluation, aggregate recalculation, report exports, OTA campaign orchestration and calls to the eSIM provider API. Commands are created by users and schedules, not by the telemetry stream, so their volume stays low even at 50,000 devices; a command and its state change are written in the same database transaction.»; «Considered as alternatives and rejected: RabbitMQ — a separate stateful cluster to operate without functional gain at this volume; Azure Service Bus — on cost at fleet scale and on portability.»
- Второй абзац D-03 («Telemetry does not pass through this broker…») — «broker» заменить на «queue», остальное без изменений.

**I-6. §4.10 Infrastructure and deployment**
- Сейчас: «Application components run on AKS. Stateful services — the TimescaleDB cluster, RabbitMQ and Redis — run in a separate node pool with independent backup.»
- Предлагается: «Application components run on Azure Container Apps with automatic scaling. Shared state is held by managed services — Azure Database for PostgreSQL (business data and job queue) and Azure Managed Redis; telemetry runs on TimescaleDB on dedicated virtual machines with independent backup.»

**I-7. §6.1, пункт 3**
- Сейчас: «Data platform maintenance: backup verification, TimescaleDB, RabbitMQ and Redis health, patching»
- Предлагается: «Data platform maintenance: backup verification, TimescaleDB health and patching, configuration of managed services»

**I-8. Встроенный endpoint IoT Hub — дописать в D-03, второй абзац**
- Предлагается дописать: «The IoT Hub is created with enough partitions on its built-in endpoint for the 50,000-device target, because the partition count cannot be changed after creation.»

**I-9. A-03 — стоимость**
- Предлагается дописать в последствие: «Managed services (Azure Managed Redis, Container Apps) replace self-operated components; the estimated monthly consumption for the pilot and for [3,000] devices is given in Appendix [X].» — приложение с расчётом стоимости по калькулятору Azure **подготовить до выпуска v1.3** [приложить].
- Почему: управляемые сервисы дороже в подписке, но снимают эксплуатацию трёх кластеров; SIG платит за подписку (A-03) и должна видеть разницу.

**I-10. Оставшиеся упоминания AKS и брокера**

| Где | Сейчас | Предлагается |
|---|---|---|
| §4.2, список слоёв, п. 3 | «Business events and commands travel through a separate message broker.» | «Business events and commands are processed through a job queue in the business database.» |
| D-04, первый абзац | «connected to the AKS ingress over Private Link, so the origin has no public address.» | при F-1 (а): «connected to an internal Azure Container Apps environment over Private Link, so the origin has no public address.»; при F-1 (б): «Application Gateway reaches an internal Azure Container Apps environment through the virtual network, so the origin has no public address.» |
| §5.2, Integration tests | «Database, message broker, IoT gateway, external adapters against test doubles» | «Database and job queue, IoT gateway, external adapters against test doubles» |

