// Схема БД `app` — бизнес-данные платформы (ТЗ Stage 1 §7.2, §6.3). Ведёт дорожка «Платформа».
// Все таблицы, кроме справочников, несут tenant_id; изоляция — RLS (миграция contract). Ссылки между сущностями
// арендатора — составными ключами (tenant_id, id): строка не может сослаться на объект другого арендатора.
// Удаление — логическое (deleted_at). Время — UTC (timestamptz).
// Чего здесь нет — у дорожки «Устройство» (схема telemetry, §6.3): кадры, события, агрегаты, команды, алерты,
// а также то, что сообщает устройство: прошивка, last seen, тех. состояние, отпечаток сертификата (provisioning).
import { sql } from 'drizzle-orm';
import {
  pgSchema, uuid, text, timestamp, integer, boolean, numeric, jsonb, doublePrecision, date, uniqueIndex, index, check,
  unique, foreignKey, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const app = pgSchema('app');

export const role = app.enum('role', ['admin', 'tech', 'exec', 'dispatcher', 'end_user', 'sig_admin']);
export const userStatus = app.enum('user_status', ['invited', 'active', 'blocked']);
export const language = app.enum('language', ['lv', 'ru', 'en', 'et', 'lt']);
export const clientType = app.enum('client_type', ['organization', 'person']);
export const coordsSource = app.enum('coords_source', ['geocoded', 'manual']);
export const waterSource = app.enum('water_source', ['bottle_top', 'bottle_bottom', 'mains']);
export const variant = app.enum('variant', ['A', 'S']);
export const lifecycle = app.enum('lifecycle', ['stock', 'active', 'installed', 'maintenance', 'disabled', 'decommissioned', 'reassigned']);
export const ownership = app.enum('ownership', ['rent', 'purchase']);
export const historyField = app.enum('history_field', ['client', 'address', 'lifecycle', 'ownership']);
export const esimStatus = app.enum('esim_status', ['inventory', 'active', 'suspended', 'closed']);
export const esimOpType = app.enum('esim_op_type', ['activate', 'suspend', 'resume', 'close']);
export const esimOpStatus = app.enum('esim_op_status', ['requested', 'confirmed', 'verified', 'failed']);
export const severity = app.enum('severity', ['info', 'warning', 'critical']);
export const scheduleSource = app.enum('schedule_source', ['platform', 'local']);
export const tokenKind = app.enum('token_kind', ['invitation', 'password_reset']);

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const tenantId = () => uuid('tenant_id').notNull().references(() => tenant.id);
/** Время события, по умолчанию — момент вставки. */
const nowAt = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
const createdAt = () => nowAt('created_at');
const ts = (name: string) => timestamp(name, { withTimezone: true });
const deletedAt = () => ts('deleted_at');
/** Ссылка внутри арендатора: (tenant_id, col) → parent(tenant_id, id). */
const sameTenant = (name: string, tenant: AnyPgColumn, col: AnyPgColumn, parent: { tenantId: AnyPgColumn; id: AnyPgColumn }) =>
  foreignKey({ name, columns: [tenant, col], foreignColumns: [parent.tenantId, parent.id] });

// ---- арендаторы, пользователи, роли

export const tenant = app.table('tenant', {
  id: id(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('tenant_code_uq').on(t.code),
  check('tenant_code_ck', sql`${t.code} ~ '^[a-z0-9-]{2,32}$'`),
]);

/** Пользователь: оператор, End User или SIG Administrator (tenant_id = null). */
export const appUser = app.table('app_user', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  language: language('language').notNull().default('en'),
  status: userStatus('status').notNull().default('invited'),
  passwordHash: text('password_hash'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('app_user_email_uq').on(sql`lower(${t.email})`).where(sql`${t.deletedAt} is null`),
  index('app_user_tenant_ix').on(t.tenantId),
  unique('app_user_tenant_id_uq').on(t.tenantId, t.id),
]);

/** Роль пользователя (раздел 2); в Stage 1 — одна на пользователя. */
export const roleAssignment = app.table('role_assignment', {
  userId: uuid('user_id').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  role: role('role').notNull(),
  assignedBy: uuid('assigned_by').references(() => appUser.id),
  assignedAt: nowAt('assigned_at'),
}, (t) => [
  foreignKey({ name: 'role_assignment_user_fk', columns: [t.userId], foreignColumns: [appUser.id] }),
  sameTenant('role_assignment_user_tenant_fk', t.tenantId, t.userId, appUser),
  check('role_assignment_sig_ck', sql`(${t.role} = 'sig_admin') = (${t.tenantId} is null)`),
]);

/** Сессии порталов: хранится хеш идентификатора. До выбора арендатора ищутся функцией app.auth_lookup_session. */
export const authSession = app.table('auth_session', {
  idHash: text('id_hash').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  userId: uuid('user_id').notNull(),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [
  index('auth_session_user_ix').on(t.userId),
  foreignKey({ name: 'auth_session_user_fk', columns: [t.userId], foreignColumns: [appUser.id] }),
  sameTenant('auth_session_user_tenant_fk', t.tenantId, t.userId, appUser),
]);

/** Приглашения (72 ч, §7.5) и восстановление пароля: хранится хеш токена, токен одноразовый; ищется app.auth_lookup_token. */
export const authToken = app.table('auth_token', {
  tokenHash: text('token_hash').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  kind: tokenKind('kind').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
}, (t) => [
  foreignKey({ name: 'auth_token_user_fk', columns: [t.userId], foreignColumns: [appUser.id] }),
  sameTenant('auth_token_user_tenant_fk', t.tenantId, t.userId, appUser),
]);

// ---- клиенты

export const client = app.table('client', {
  id: id(),
  tenantId: tenantId(),
  type: clientType('type').notNull(),
  name: text('name').notNull(),
  regNumber: text('reg_number'),
  legalAddress: text('legal_address'),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index('client_tenant_ix').on(t.tenantId), unique('client_tenant_id_uq').on(t.tenantId, t.id)]);

export const address = app.table('address', {
  id: id(),
  tenantId: tenantId(),
  clientId: uuid('client_id').notNull(),
  address: text('address').notNull(),
  region: text('region'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  coordsSource: coordsSource('coords_source'),
  floor: text('floor'),
  place: text('place'),
  accessNote: text('access_note'),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  index('address_client_ix').on(t.clientId),
  unique('address_tenant_id_uq').on(t.tenantId, t.id),
  unique('address_client_id_uq').on(t.tenantId, t.clientId, t.id),
  sameTenant('address_client_fk', t.tenantId, t.clientId, client),
  check('address_lat_ck', sql`${t.lat} between -90 and 90`),
  check('address_lng_ck', sql`${t.lng} between -180 and 180`),
]);

export const contact = app.table('contact', {
  id: id(),
  tenantId: tenantId(),
  clientId: uuid('client_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  role: text('role'),
  comment: text('comment'),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [index('contact_client_ix').on(t.clientId), sameTenant('contact_client_fk', t.tenantId, t.clientId, client)]);

/** Доступ End User к клиенту (§7.5): многие ко многим, с датой и тем, кто привязал. */
export const endUserAccess = app.table('end_user_access', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  clientId: uuid('client_id').notNull(),
  boundAt: nowAt('bound_at'),
  boundBy: uuid('bound_by').notNull(),
  deletedAt: deletedAt(),
}, (t) => [
  sameTenant('end_user_access_user_fk', t.tenantId, t.userId, appUser),
  sameTenant('end_user_access_client_fk', t.tenantId, t.clientId, client),
  sameTenant('end_user_access_bound_by_fk', t.tenantId, t.boundBy, appUser),
  uniqueIndex('end_user_access_uq').on(t.userId, t.clientId).where(sql`${t.deletedAt} is null`),
]);

// ---- eSIM

export const esimProfile = app.table('esim_profile', {
  id: id(),
  tenantId: tenantId(),
  iccid: text('iccid').notNull(),
  eid: text('eid'),
  imsi: text('imsi'),
  msisdn: text('msisdn'),
  imei: text('imei'),
  apn: text('apn'),
  carrier: text('carrier'),
  tariff: text('tariff'),
  trafficLimitMb: integer('traffic_limit_mb'),
  status: esimStatus('status').notNull().default('inventory'),
  contractUntil: date('contract_until'),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('esim_profile_iccid_uq').on(t.iccid).where(sql`${t.deletedAt} is null`),
  unique('esim_profile_tenant_id_uq').on(t.tenantId, t.id),
  check('esim_profile_iccid_ck', sql`${t.iccid} ~ '^[0-9]{18,22}$'`),
]);

export const esimOperation = app.table('esim_operation', {
  id: id(),
  tenantId: tenantId(),
  profileId: uuid('profile_id').notNull(),
  type: esimOpType('type').notNull(),
  status: esimOpStatus('status').notNull().default('requested'),
  providerTicket: text('provider_ticket'),
  providerDate: date('provider_date'),
  comment: text('comment'),
  createdAt: createdAt(),
  createdBy: uuid('created_by').notNull(),
  confirmedAt: ts('confirmed_at'),
  confirmedBy: uuid('confirmed_by'),
  verifiedAt: ts('verified_at'),
}, (t) => [
  sameTenant('esim_operation_profile_fk', t.tenantId, t.profileId, esimProfile),
  sameTenant('esim_operation_created_by_fk', t.tenantId, t.createdBy, appUser),
  sameTenant('esim_operation_confirmed_by_fk', t.tenantId, t.confirmedBy, appUser),
  index('esim_operation_profile_ix').on(t.profileId),
  check('esim_operation_confirm_ck', sql`(${t.status} = 'requested') or (${t.providerTicket} is not null and ${t.confirmedAt} is not null)`),
]);

// ---- устройства

export const device = app.table('device', {
  id: id(),
  tenantId: tenantId(),
  /** Device ID в IoT Hub — уникален во всей платформе. */
  deviceId: text('device_id').notNull(),
  serial: text('serial').notNull(),
  imei: text('imei'),
  waterSource: waterSource('water_source').notNull(),
  variant: variant('variant').notNull(),
  carbonated: boolean('carbonated').notNull(),
  sku: text('sku'),
  hw: text('hw'),
  lifecycle: lifecycle('lifecycle').notNull().default('stock'),
  ownership: ownership('ownership').notNull().default('purchase'),
  clientId: uuid('client_id'),
  addressId: uuid('address_id'),
  esimProfileId: uuid('esim_profile_id'),
  description: text('description'),
  /** Доступ в IoT Hub отозван (V-032) — исполняет provisioning. */
  blockedAt: ts('blocked_at'),
  blockedBy: uuid('blocked_by'),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('device_device_id_uq').on(t.deviceId),
  uniqueIndex('device_serial_uq').on(t.tenantId, t.serial).where(sql`${t.deletedAt} is null`),
  uniqueIndex('device_imei_uq').on(t.imei).where(sql`${t.deletedAt} is null and ${t.imei} is not null`),
  uniqueIndex('device_esim_uq').on(t.esimProfileId).where(sql`${t.deletedAt} is null and ${t.esimProfileId} is not null`),
  index('device_client_ix').on(t.clientId),
  unique('device_tenant_id_uq').on(t.tenantId, t.id),
  sameTenant('device_client_fk', t.tenantId, t.clientId, client),
  // Адрес — того же клиента: (tenant_id, client_id, address_id) → address(tenant_id, client_id, id).
  foreignKey({ name: 'device_address_fk', columns: [t.tenantId, t.clientId, t.addressId], foreignColumns: [address.tenantId, address.clientId, address.id] }),
  sameTenant('device_esim_fk', t.tenantId, t.esimProfileId, esimProfile),
  sameTenant('device_blocked_by_fk', t.tenantId, t.blockedBy, appUser),
  check('device_device_id_ck', sql`${t.deviceId} ~ '^[A-Za-z0-9._:-]{1,128}$'`),
  check('device_imei_ck', sql`${t.imei} ~ '^[0-9]{15}$'`),
  check('device_address_ck', sql`${t.addressId} is null or ${t.clientId} is not null`),
]);

/** История устройства (V-014, P-09): что изменилось, кем, когда. Только добавление. */
export const deviceHistory = app.table('device_history', {
  id: id(),
  tenantId: tenantId(),
  deviceId: uuid('device_id').notNull(),
  at: nowAt('at'),
  by: uuid('by'),
  field: historyField('field').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  comment: text('comment'),
}, (t) => [
  index('device_history_device_ix').on(t.deviceId, t.at),
  sameTenant('device_history_device_fk', t.tenantId, t.deviceId, device),
  sameTenant('device_history_by_fk', t.tenantId, t.by, appUser),
]);

/** Справочник кодов ошибок (V-096, RE-4) — общий для всех арендаторов. */
export const errorCode = app.table('error_code', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
  severity: severity('severity').notNull().default('warning'),
  action: text('action'),
}, (t) => [check('error_code_ck', sql`${t.code} ~ '^(B[1-3]|C[A-Za-z0-9_]{1,31})$'`)]);

// ---- вода, фильтры, расписание

/** Сброс счётчика потребления — точка отсчёта на платформе (§7.2), не команда устройству. */
export const consumptionReset = app.table('consumption_reset', {
  id: id(),
  tenantId: tenantId(),
  deviceId: uuid('device_id').notNull(),
  at: nowAt('at'),
  by: uuid('by').notNull(),
  waterTotalL: numeric('water_total_l', { precision: 14, scale: 3 }).notNull(),
}, (t) => [
  index('consumption_reset_device_ix').on(t.deviceId, t.at),
  sameTenant('consumption_reset_device_fk', t.tenantId, t.deviceId, device),
  sameTenant('consumption_reset_by_fk', t.tenantId, t.by, appUser),
]);

/** Установка фильтра; действующий — последний по installed_at. Сброс — новая запись и команда filterreset. */
export const filterInstall = app.table('filter_install', {
  id: id(),
  tenantId: tenantId(),
  deviceId: uuid('device_id').notNull(),
  installedAt: nowAt('installed_at'),
  installedBy: uuid('installed_by'),
  nominalL: numeric('nominal_l', { precision: 10, scale: 1 }).notNull(),
  waterTotalL: numeric('water_total_l', { precision: 14, scale: 3 }).notNull(),
  replaceBy: ts('replace_by'),
  /** Команда POST filterreset:1 (схема telemetry). */
  commandId: uuid('command_id'),
}, (t) => [
  index('filter_install_device_ix').on(t.deviceId, t.installedAt),
  sameTenant('filter_install_device_fk', t.tenantId, t.deviceId, device),
  sameTenant('filter_install_by_fk', t.tenantId, t.installedBy, appUser),
]);

/**
 * Версии расписания (§7.3, «Расписание»). Номер растёт на устройство; действующая — с наибольшим changed_at
 * (при равенстве — с наибольшим номером): при изменении и на месте, и на платформе действует более позднее,
 * другое остаётся в истории. Пишется только функциями app.schedule_store_platform / app.schedule_store_local:
 * они выдают номер под блокировкой устройства и проверяют расписание и часовой пояс.
 */
export const scheduleVersion = app.table('schedule_version', {
  id: id(),
  tenantId: tenantId(),
  deviceId: uuid('device_id').notNull(),
  version: integer('version').notNull(),
  timezone: text('timezone').notNull(),
  /** Строка autopowerscheduling существующей прошивки. */
  content: text('content').notNull(),
  source: scheduleSource('source').notNull(),
  /** local:<время> с устройства — для версий, сохранённых по изменению на месте. */
  localVersion: text('local_version'),
  /** Когда изменено: на платформе — время создания, на месте — время с устройства. */
  changedAt: ts('changed_at').notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('schedule_version_uq').on(t.deviceId, t.version),
  sameTenant('schedule_version_device_fk', t.tenantId, t.deviceId, device),
  sameTenant('schedule_version_by_fk', t.tenantId, t.createdBy, appUser),
  uniqueIndex('schedule_version_local_uq').on(t.deviceId, t.localVersion).where(sql`${t.localVersion} is not null`),
  check('schedule_version_ck', sql`${t.version} > 0`),
  check('schedule_version_source_ck', sql`(${t.source} = 'local') = (${t.localVersion} is not null)`),
  check('schedule_version_content_ck', sql`length(${t.content}) <= 1024`),
]);

/**
 * Обработанные отчёты устройства о локальной версии расписания (schedule_applied local): повтор того же
 * local_version — без новой версии и аудита, даже если сообщение совпало с версией платформы (не дошёл schedversion).
 */
export const scheduleLocalReport = app.table('schedule_local_report', {
  tenantId: tenantId(),
  deviceId: uuid('device_id').notNull(),
  localVersion: text('local_version').notNull(),
  /** Номер, которым сообщение обработано: сохранённая локальная версия или совпавшая версия платформы. */
  version: integer('version').notNull(),
  receivedAt: nowAt('received_at'),
}, (t) => [
  primaryKey({ name: 'schedule_local_report_pk', columns: [t.deviceId, t.localVersion] }),
  sameTenant('schedule_local_report_device_fk', t.tenantId, t.deviceId, device),
]);

// ---- настройки, аудит, уведомления

/** Значения платформы по умолчанию (§7.4) — общие. */
export const settingDefault = app.table('setting_default', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/** Значение на уровне арендатора (device_id = null) или устройства; наследование — платформа → арендатор → устройство.
 *  Снять переопределение — удалить строку (единственное физическое удаление в app). */
export const setting = app.table('setting', {
  id: id(),
  tenantId: tenantId(),
  deviceId: uuid('device_id'),
  key: text('key').notNull().references(() => settingDefault.key),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: nowAt('updated_at'),
}, (t) => [
  uniqueIndex('setting_tenant_uq').on(t.tenantId, t.key).where(sql`${t.deviceId} is null`),
  sameTenant('setting_device_fk', t.tenantId, t.deviceId, device),
  sameTenant('setting_by_fk', t.tenantId, t.updatedBy, appUser),
  check('setting_value_ck', sql`${t.value} <> 'null'::jsonb`),
  uniqueIndex('setting_device_uq').on(t.deviceId, t.key).where(sql`${t.deviceId} is not null`),
]);

/** Журнал аудита (V-005): только добавление — изменение и удаление запрещены триггером. */
export const auditLog = app.table('audit_log', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  at: nowAt('at'),
  userId: uuid('user_id'),
  /** Кто: user — пользователь; иначе служба (api, provisioning, dispatcher, ingest, jobs-telemetry, jobs-app). */
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
}, (t) => [
  index('audit_log_tenant_at_ix').on(t.tenantId, t.at),
  // Без составного ключа: SIG Administrator (вне арендатора) пишет аудит в созданного им арендатора.
  foreignKey({ name: 'audit_log_user_fk', columns: [t.userId], foreignColumns: [appUser.id] }),
  check('audit_log_actor_ck', sql`(${t.actor} = 'user') = (${t.userId} is not null)`),
]);

/** Лента уведомлений пользователя (V-119). */
export const notification = app.table('notification', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  at: nowAt('at'),
  kind: text('kind').notNull(),
  alertId: uuid('alert_id'),
  deviceId: uuid('device_id'),
  text: text('text').notNull(),
  readAt: ts('read_at'),
}, (t) => [
  index('notification_user_ix').on(t.userId, t.at),
  sameTenant('notification_user_fk', t.tenantId, t.userId, appUser),
  sameTenant('notification_device_fk', t.tenantId, t.deviceId, device),
]);

