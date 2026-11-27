// Канал IoT Hub на локальном брокере MQTT: темы, свойство mt, подписка на C2D, переподключение.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Aedes } from 'aedes';
import { RealClock } from '../src/clock.ts';
import { VirtualDevice } from '../src/device.ts';
import { IotHubLink, d2cTopic, c2dFilter, sasToken } from '../src/transport/iothub.ts';
import { contractErrors } from './contract.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('не дождались'); await wait(20); }
}

test('темы IoT Hub и SAS-токен', () => {
  assert.equal(d2cTopic('sim-0001', 'frame'), 'devices/sim-0001/messages/events/mt=frame&%24.ct=application%2Fjson&%24.ce=utf-8');
  assert.equal(c2dFilter('sim-0001'), 'devices/sim-0001/messages/devicebound/#');
  const t = sasToken('hub.azure-devices.net', 'd1', Buffer.from('secret').toString('base64'), 60, 1_000_000);
  // Ожидаемое значение посчитано независимо (Python hmac/sha256).
  assert.equal(t, 'SharedAccessSignature sr=hub.azure-devices.net%2Fdevices%2Fd1&sig=5j8Ru%2BRXKhKxcteF1na1sHHJ0jfRksFhKDjLzEWnw9g%3D&se=1000060');
});

test('устройство через MQTT: hello с mt, команда из devicebound → ack и результат; обрыв → переподключение и снова команды', async () => {
  const broker = await Aedes.createBroker();
  const server = net.createServer(broker.handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const got: { mt: string; body: Record<string, unknown> }[] = [];
  const auth: { username?: string }[] = [];
  broker.authenticate = (client, username, _pw, done) => { auth.push({ username: username ?? '' }); done(null, true); void client; };
  broker.on('publish', (packet, client) => {
    if (!client) return;
    const m = /^devices\/dev-mq\/messages\/events\/mt=([a-z]+)&/.exec(packet.topic);
    if (m) got.push({ mt: m[1]!, body: JSON.parse(packet.payload.toString()) });
  });
  const clock = new RealClock(1);
  const link = new IotHubLink({ host: 'hub.example', deviceId: 'dev-mq', auth: { kind: 'none' }, url: `mqtt://127.0.0.1:${port}` });
  const dev = new VirtualDevice(clock, link, {
    id: 'dev-mq', model: { water_source: 'mains', variant: 'S', carbonated: false }, timeSyncMs: 10, reconnectMs: [100, 200],
  });
  try {
    dev.powerOn();
    await until(() => got.some((g) => g.mt === 'hello'));
    assert.equal(auth[0]!.username, 'hub.example/dev-mq/?api-version=2021-04-12');
    const cmd = { v: 0, cmd_id: 'mq1', deadline_at: new Date(Date.now() + 30_000).toISOString(), op: 'GET', param: 'all' };
    broker.publish({ cmd: 'publish', topic: 'devices/dev-mq/messages/devicebound/%24.mid=1&%24.to=%2Fdevices%2Fdev-mq%2Fmessages%2FdeviceBound',
      payload: Buffer.from(JSON.stringify(cmd)), qos: 1, retain: false, dup: false }, () => {});
    await until(() => got.some((g) => g.mt === 'frame' && g.body['cmd_id'] === 'mq1'));
    assert.ok(got.some((g) => g.mt === 'ack' && g.body['cmd_id'] === 'mq1'));
    assert.ok(got.some((g) => g.mt === 'result' && g.body['cmd_id'] === 'mq1' && g.body['code'] === 200));
    for (const g of got) assert.deepEqual(contractErrors({ mt: g.mt, body: g.body } as never), [], g.mt);
    // Обрыв со стороны брокера: устройство само переподключается, заново подписывается на C2D и шлёт hello.
    const hellos = got.filter((g) => g.mt === 'hello').length;
    (broker as unknown as { clients: Record<string, { close(): void }> }).clients['dev-mq']!.close();
    await until(() => !dev.connected);
    await until(() => got.filter((g) => g.mt === 'hello').length > hellos);
    const cmd2 = { v: 0, cmd_id: 'mq2', deadline_at: new Date(Date.now() + 30_000).toISOString(), op: 'GET', param: 'otaallowed' };
    broker.publish({ cmd: 'publish', topic: 'devices/dev-mq/messages/devicebound/%24.mid=2',
      payload: Buffer.from(JSON.stringify(cmd2)), qos: 1, retain: false, dup: false }, () => {});
    await until(() => got.some((g) => g.mt === 'result' && g.body['cmd_id'] === 'mq2'));
    for (const g of got) assert.deepEqual(contractErrors({ mt: g.mt, body: g.body } as never), [], g.mt);
  } finally {
    dev.powerOff();
    await new Promise<void>((r) => broker.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  }
});
