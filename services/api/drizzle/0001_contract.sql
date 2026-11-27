-- Права, изоляция арендаторов и объекты на стыке дорожек (ТЗ Stage 1 §6.3, §7.2, P-07).
-- Интерфейс для дорожки «Устройство» — contracts/db/app-interface.json (тест сверяет его с этой миграцией).
--
-- Роли (NOLOGIN; учётные записи служб получают их в infra):
--   app_api    — службы дорожки «Платформа» (api, jobs-app): таблицы app под RLS по арендатору;
--   app_device — службы дорожки «Устройство» (ingest, dispatcher, provisioning, jobs-telemetry): только
--                представления v_device, v_device_schedule, v_device_setting и функции audit_append,
--                schedule_store_local. Прочих прав на схему app нет.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN CREATE ROLE app_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_device') THEN CREATE ROLE app_device NOLOGIN; END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_api, app_device;
--> statement-breakpoint

-- Арендатор текущего запроса: API ставит его в начале транзакции — set_config('app.tenant_id', <uuid>, true).
CREATE FUNCTION app.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
-- Запрос SIG Administrator (пользователь вне арендатора): API ставит set_config('app.scope', 'global', true)
-- только после проверки его сессии. Тогда видны строки с tenant_id = null — его собственные.
CREATE FUNCTION app.is_global() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.scope', true), '') = 'global' $$;
--> statement-breakpoint

-- ---- права дорожки «Платформа»: чтение, добавление, изменение; удаление — только логическое (deleted_at)
GRANT SELECT, INSERT, UPDATE ON
  app.tenant, app.app_user, app.role_assignment, app.auth_session, app.auth_token, app.client, app.address,
  app.contact, app.end_user_access, app.esim_profile, app.esim_operation, app.device, app.consumption_reset,
  app.filter_install, app.setting, app.notification
  TO app_api;
--> statement-breakpoint
-- Снять переопределение настройки — удалить строку; других физических удалений в app нет.
GRANT DELETE ON app.setting TO app_api;
--> statement-breakpoint
-- Версии расписания пишутся только функциями app.schedule_store_platform / app.schedule_store_local.
GRANT SELECT ON app.schedule_version, app.schedule_local_report TO app_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.audit_log, app.device_history TO app_api;
--> statement-breakpoint
GRANT SELECT ON app.error_code, app.setting_default TO app_api;
--> statement-breakpoint

-- ---- RLS: строка видна и пишется, только если tenant_id = текущему арендатору (P-07).
-- Владелец таблиц (роль миграций) RLS не подчиняется — на этом работают представления для app_device.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client', 'address', 'contact', 'end_user_access', 'esim_profile', 'esim_operation',
    'device', 'device_history', 'consumption_reset', 'filter_install', 'schedule_version', 'schedule_local_report',
    'setting', 'notification']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON app.%I TO app_api
      USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t);
  END LOOP;
  -- Таблицы, где есть строки вне арендатора (SIG Administrator): видны только в режиме app.scope = global.
  FOREACH t IN ARRAY ARRAY['app_user', 'role_assignment', 'auth_session', 'auth_token', 'audit_log']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON app.%I TO app_api
      USING (tenant_id = app.current_tenant() OR (tenant_id IS NULL AND app.is_global()))
      WITH CHECK (tenant_id = app.current_tenant() OR (tenant_id IS NULL AND app.is_global()))', t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- SIG Administrator создаёт арендатора (§2): в режиме global — любой арендатор.
CREATE POLICY tenant_isolation ON app.tenant TO app_api
  USING (id = app.current_tenant() OR app.is_global()) WITH CHECK (id = app.current_tenant() OR app.is_global());

-- ---- только добавление: журнал аудита и история устройства
CREATE FUNCTION app.forbid_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION '% — только добавление', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();
--> statement-breakpoint
CREATE TRIGGER device_history_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.device_history
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();
--> statement-breakpoint

-- ---- вход: поиск до выбора арендатора (только app_api). Найдя пользователя, API ставит его арендатора
-- (или app.scope = global для SIG Administrator) и дальше работает с таблицами под RLS.
CREATE FUNCTION app.auth_lookup_email(p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, role app.role, status app.user_status, password_hash text,
                 failed_logins integer, locked_until timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
    SELECT u.id, u.tenant_id, r.role, u.status, u.password_hash, u.failed_logins, u.locked_until
    FROM app.app_user u JOIN app.role_assignment r ON r.user_id = u.id
    WHERE lower(u.email) = lower(p_email) AND u.deleted_at IS NULL
  $$;
--> statement-breakpoint
CREATE FUNCTION app.auth_lookup_session(p_id_hash text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, role app.role, status app.user_status, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
    SELECT u.id, u.tenant_id, r.role, u.status, s.expires_at
    FROM app.auth_session s
    JOIN app.app_user u ON u.id = s.user_id AND u.deleted_at IS NULL
    JOIN app.role_assignment r ON r.user_id = u.id
    WHERE s.id_hash = p_id_hash AND s.revoked_at IS NULL AND s.expires_at > now()
      AND u.status = 'active'
  $$;
--> statement-breakpoint
CREATE FUNCTION app.auth_lookup_token(p_token_hash text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, kind app.token_kind)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
    SELECT t.user_id, t.tenant_id, t.kind FROM app.auth_token t
    JOIN app.app_user u ON u.id = t.user_id AND u.deleted_at IS NULL
    WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  $$;
--> statement-breakpoint

-- ---- значения по умолчанию (§7.4) и настройки устройства
INSERT INTO app.setting_default (key, value) VALUES
  ('offline_after_min', '3'), ('offline_alert_after_min', '15'),
  ('hot_alert_below_set_c', '10'), ('hot_alert_above_c', '99'), ('hot_alert_after_min', '10'),
  ('cold_alert_above_set_c', '5'), ('cold_alert_below_c', '1'), ('cold_alert_after_min', '15'),
  ('filter_warning_pct', '20'), ('filter_critical_pct', '5'), ('upcoming_filters_days', '30'),
  ('filter_forecast_window_days', '30'),
  ('ota_allowed', 'false'),            -- FW-7: по умолчанию выключено
  ('timezone', '"Europe/Riga"');       -- §7.3: часовой пояс адреса по умолчанию
--> statement-breakpoint

-- ================================================================ контракт для дорожки «Устройство» (§6.3)

-- Устройство → арендатор, клиент, модель. Удалённые устройства не видны.
CREATE VIEW app.v_device AS
  SELECT d.device_id, d.id AS device_uuid, d.tenant_id, d.client_id, d.address_id,
         d.water_source, d.variant, d.carbonated, d.lifecycle, (d.blocked_at IS NOT NULL) AS blocked
  FROM app.device d
  WHERE d.deleted_at IS NULL;
--> statement-breakpoint

-- Действующее расписание: версия с наибольшим changed_at (при равенстве — с наибольшим номером).
CREATE VIEW app.v_device_schedule AS
  SELECT DISTINCT ON (s.device_id)
         d.device_id, s.version, s.timezone, s.content, s.source, s.local_version, s.changed_at
  FROM app.schedule_version s
  JOIN app.device d ON d.id = s.device_id AND d.deleted_at IS NULL
  ORDER BY s.device_id, s.changed_at DESC, s.version DESC;
--> statement-breakpoint

-- Действующие настройки устройства: устройство → арендатор → платформа (§7.2), в том числе ota_allowed.
CREATE VIEW app.v_device_setting AS
  SELECT d.device_id, k.key,
         coalesce(sd.value, st.value, k.value) AS value,
         CASE WHEN sd.value IS NOT NULL THEN 'device' WHEN st.value IS NOT NULL THEN 'tenant' ELSE 'platform' END AS level
  FROM app.device d
  CROSS JOIN app.setting_default k
  LEFT JOIN app.setting st ON st.tenant_id = d.tenant_id AND st.device_id IS NULL AND st.key = k.key
  LEFT JOIN app.setting sd ON sd.device_id = d.id AND sd.key = k.key
  WHERE d.deleted_at IS NULL;
--> statement-breakpoint

-- Проверка расписания (те же правила, что contracts/scripts/semantics.mjs) и часового пояса IANA.
CREATE FUNCTION app.schedule_check(p_content text, p_timezone text) RETURNS void
  LANGUAGE plpgsql IMMUTABLE
  AS $$
  DECLARE
    e text; m text[]; days int[] := '{}'; hol int[] := '{}';
  BEGIN
    IF p_content IS NULL OR length(p_content) > 1024 OR (p_content <> '' AND (right(p_content, 1) <> ';' OR p_content = ';')) THEN
      RAISE EXCEPTION 'расписание: не в формате autopowerscheduling' USING ERRCODE = '22023';
    END IF;
    -- Снимается ровно один завершающий «;»: пустые записи («;;») не проходят формат.
    FOREACH e IN ARRAY coalesce(string_to_array(nullif(left(p_content, -1), ''), ';'), '{}'::text[]) LOOP
      m := regexp_match(e, '^w([1-7]),([01][0-9]|2[0-3]):([0-5][0-9]),([01][0-9]|2[0-3]):([0-5][0-9])$');
      IF m IS NOT NULL THEN
        IF m[1]::int = ANY (days) THEN RAISE EXCEPTION 'расписание: больше одного окна на день %', m[1] USING ERRCODE = '22023'; END IF;
        days := days || m[1]::int;
        CONTINUE;
      END IF;
      m := regexp_match(e, '^f([0-9]|[12][0-9]|3[0-2]),([0-9]{1,10}),([0-9]{1,10})$');
      IF m IS NOT NULL THEN
        IF m[1]::int = ANY (hol) THEN RAISE EXCEPTION 'расписание: номер выходного % повторяется', m[1] USING ERRCODE = '22023'; END IF;
        IF m[2]::bigint >= m[3]::bigint THEN RAISE EXCEPTION 'расписание: выходной % — начало не раньше конца', m[1] USING ERRCODE = '22023'; END IF;
        hol := hol || m[1]::int;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'расписание: запись «%» не в формате autopowerscheduling', e USING ERRCODE = '22023';
    END LOOP;
    IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
      RAISE EXCEPTION 'расписание: часовой пояс «%» не IANA', p_timezone USING ERRCODE = '22023';
    END IF;
  END $$;
--> statement-breakpoint

-- Новая версия расписания с платформы (портал, API). Номер — под блокировкой строки устройства, той же, что
-- у schedule_store_local: параллельные изменения получают разные номера. Устройство — только своего арендатора.
CREATE FUNCTION app.schedule_store_platform(p_device uuid, p_timezone text, p_content text, p_user uuid)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
  DECLARE d app.device; v_next integer;
  BEGIN
    SELECT * INTO d FROM app.device
      WHERE id = p_device AND tenant_id = app.current_tenant() AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'schedule_store_platform: нет устройства' USING ERRCODE = 'P0002';
    END IF;
    PERFORM app.schedule_check(p_content, p_timezone);
    SELECT coalesce(max(version), 0) + 1 INTO v_next FROM app.schedule_version WHERE device_id = d.id;
    INSERT INTO app.schedule_version (tenant_id, device_id, version, timezone, content, source, changed_at, created_by)
      VALUES (d.tenant_id, d.id, v_next, p_timezone, p_content, 'platform', now(), p_user);
    RETURN v_next;
  END $$;
--> statement-breakpoint

-- Запись аудита от служб дорожки «Устройство»: provisioning — выпуск, ротация, отзыв сертификатов (CERT);
-- dispatcher — служебные действия с командами; ingest и jobs-telemetry — свои действия. Возвращает id записи.
CREATE FUNCTION app.audit_append(p_tenant_id uuid, p_actor text, p_action text, p_object_type text,
                                 p_object_id text, p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
  DECLARE v_id uuid;
  BEGIN
    IF p_actor IS NULL OR p_actor NOT IN ('provisioning', 'dispatcher', 'ingest', 'jobs-telemetry') THEN
      RAISE EXCEPTION 'audit_append: служба «%» не из дорожки «Устройство»', p_actor USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action !~ '^[a-z_]+(\.[a-z_]+)+$' THEN
      RAISE EXCEPTION 'audit_append: действие «%» — нужно вида object.verb', p_action USING ERRCODE = '22023';
    END IF;
    IF p_object_type IS NULL OR p_object_type = '' THEN
      RAISE EXCEPTION 'audit_append: нет object_type' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.audit_log (tenant_id, actor, action, object_type, object_id, before, after)
      VALUES (p_tenant_id, p_actor, p_action, p_object_type, p_object_id, p_before, p_after)
      RETURNING id INTO v_id;
    RETURN v_id;
  END $$;
--> statement-breakpoint

-- Расписание, изменённое на месте (событие schedule_applied с источником local, §7.3): сохраняется новой версией
-- платформы с отметкой «изменено на месте» и записью аудита. Конфликт: действует более позднее изменение
-- (changed_at), другое остаётся в истории. Возвращает номер действующей версии: если это сохранённая локальная —
-- dispatcher шлёт schedversion:<номер>,<CRC>; если действует более позднее изменение платформы — его содержимое
-- отличается от устройства, и dispatcher шлёт всю последовательность (timezone → autopowerscheduling → schedversion).
-- Повтор того же события (тот же local_version, учёт — schedule_local_report) новой версии не создаёт. Если содержимое и пояс совпадают с
-- действующей версией — это не изменение на месте, а не дошедший schedversion: новой версии нет, возвращается
-- номер действующей, и dispatcher повторяет schedversion (§7.3). p_timezone null — прежний пояс.
CREATE FUNCTION app.schedule_store_local(p_device_id text, p_content text, p_local_version text,
                                         p_changed_at timestamptz, p_timezone text DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
  DECLARE
    d app.device;
    v_next integer;
    v_tz text;
    v_cur record;
    v_current integer;
  BEGIN
    SELECT * INTO d FROM app.device WHERE device_id = p_device_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'schedule_store_local: нет устройства «%»', p_device_id USING ERRCODE = 'P0002';
    END IF;
    -- Версия — как в контракте (contracts/schemas/common.schema.json) и существующее время.
    IF p_local_version IS NULL OR p_local_version !~
       '^local:[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' THEN
      RAISE EXCEPTION 'schedule_store_local: версия «%» — нужно local:<время ISO-8601>', p_local_version USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM substr(p_local_version, 7)::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'schedule_store_local: версия «%» — нет такого времени', p_local_version USING ERRCODE = '22023';
    END;
    IF p_changed_at IS NULL THEN
      RAISE EXCEPTION 'schedule_store_local: нет времени изменения' USING ERRCODE = '22023';
    END IF;
    v_tz := coalesce(p_timezone,
      (SELECT timezone FROM app.schedule_version WHERE device_id = d.id ORDER BY changed_at DESC, version DESC LIMIT 1),
      (SELECT value #>> '{}' FROM app.v_device_setting WHERE device_id = p_device_id AND key = 'timezone'));
    PERFORM app.schedule_check(p_content, v_tz);

    IF NOT EXISTS (SELECT 1 FROM app.schedule_local_report WHERE device_id = d.id AND local_version = p_local_version) THEN
      SELECT version, content, timezone INTO v_cur FROM app.schedule_version
        WHERE device_id = d.id ORDER BY changed_at DESC, version DESC LIMIT 1;
      IF FOUND AND v_cur.content = p_content AND v_cur.timezone = v_tz THEN
        -- не дошёл schedversion: устройство применило действующую версию — новой версии и аудита нет
        INSERT INTO app.schedule_local_report (tenant_id, device_id, local_version, version)
          VALUES (d.tenant_id, d.id, p_local_version, v_cur.version);
      ELSE
      SELECT coalesce(max(version), 0) + 1 INTO v_next FROM app.schedule_version WHERE device_id = d.id;
      INSERT INTO app.schedule_version (tenant_id, device_id, version, timezone, content, source, local_version, changed_at)
        VALUES (d.tenant_id, d.id, v_next, v_tz, p_content, 'local', p_local_version, p_changed_at);
      INSERT INTO app.audit_log (tenant_id, actor, action, object_type, object_id, after)
        VALUES (d.tenant_id, 'ingest', 'schedule.store_local', 'device', d.id::text,
                jsonb_build_object('version', v_next, 'local_version', p_local_version, 'timezone', v_tz, 'content', p_content));
      INSERT INTO app.schedule_local_report (tenant_id, device_id, local_version, version)
        VALUES (d.tenant_id, d.id, p_local_version, v_next);
      END IF;
    END IF;

    SELECT version INTO v_current FROM app.schedule_version
      WHERE device_id = d.id ORDER BY changed_at DESC, version DESC LIMIT 1;
    RETURN v_current;
  END $$;
--> statement-breakpoint

-- ---- права дорожки «Устройство»: только объекты контракта
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON app.v_device, app.v_device_schedule, app.v_device_setting TO app_device;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.audit_append(uuid, text, text, text, text, jsonb, jsonb),
                          app.schedule_store_local(text, text, text, timestamptz, text) TO app_device;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_tenant(), app.is_global(), app.auth_lookup_email(text), app.auth_lookup_session(text),
  app.auth_lookup_token(text), app.schedule_store_platform(uuid, text, text, uuid) TO app_api;
