-- Уникальность идентификаторов устройства (V-011) с понятным ответом API: Device ID и IMEI уникальны во всей
-- платформе, а RLS не показывает устройства других арендаторов. Функция отвечает только «занято / свободно»,
-- не раскрывая, у кого. Только app_api.
CREATE FUNCTION app.device_identity_taken(p_device_id text, p_imei text, p_except uuid)
  RETURNS TABLE (device_id_taken boolean, imei_taken boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app
  AS $$
    SELECT
      p_device_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.device WHERE device_id = p_device_id AND (p_except IS NULL OR id <> p_except)),
      p_imei IS NOT NULL AND EXISTS (SELECT 1 FROM app.device WHERE imei = p_imei AND deleted_at IS NULL AND (p_except IS NULL OR id <> p_except))
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.device_identity_taken(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.device_identity_taken(text, text, uuid) TO app_api;
