# Azure IoT Hub

Azure IoT Hub Standard (Classic) — управляемый IoT-шлюз VENDEN. Кулеры отправляют телеметрию и heartbeat по MQTT/TLS, принимают адресные команды и возвращают результаты. Для подключения каждый кулер регистрируется в реестре IoT Hub со своими учётными данными.

| Параметр | Значение |
|---|---|
| Имя ресурса | `venden-iot-neu` |
| Группа ресурсов | `rg-venden-iot-neu` |
| Регион | North Europe |
| MQTT/TLS | `venden-iot-neu.azure-devices.net:8883` |
| Мощность одного IoT Hub | 2 × S1, до 800 000 сообщений в сутки |

По схеме интеграции бэкенд VENDEN читает телеметрию и heartbeat через встроенную точку `messages/events` и обновляет `last_seen`. Для запроса состояния онлайн-кулера предусмотрен Direct Method, для отложенной доставки команд — Cloud-to-device messages. Бэкенд ведёт журнал команд и связывает ответы устройств с `commandId`.
