CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."client_type" AS ENUM('organization', 'person');--> statement-breakpoint
CREATE TYPE "app"."coords_source" AS ENUM('geocoded', 'manual');--> statement-breakpoint
CREATE TYPE "app"."esim_op_status" AS ENUM('requested', 'confirmed', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "app"."esim_op_type" AS ENUM('activate', 'suspend', 'resume', 'close');--> statement-breakpoint
CREATE TYPE "app"."esim_status" AS ENUM('inventory', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "app"."history_field" AS ENUM('client', 'address', 'lifecycle', 'ownership');--> statement-breakpoint
CREATE TYPE "app"."language" AS ENUM('lv', 'ru', 'en', 'et', 'lt');--> statement-breakpoint
CREATE TYPE "app"."lifecycle" AS ENUM('stock', 'active', 'installed', 'maintenance', 'disabled', 'decommissioned', 'reassigned');--> statement-breakpoint
CREATE TYPE "app"."ownership" AS ENUM('rent', 'purchase');--> statement-breakpoint
CREATE TYPE "app"."role" AS ENUM('admin', 'tech', 'exec', 'dispatcher', 'end_user', 'sig_admin');--> statement-breakpoint
CREATE TYPE "app"."schedule_source" AS ENUM('platform', 'local');--> statement-breakpoint
CREATE TYPE "app"."severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "app"."token_kind" AS ENUM('invitation', 'password_reset');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('invited', 'active', 'blocked');--> statement-breakpoint
CREATE TYPE "app"."variant" AS ENUM('A', 'S');--> statement-breakpoint
CREATE TYPE "app"."water_source" AS ENUM('bottle_top', 'bottle_bottom', 'mains');--> statement-breakpoint
CREATE TABLE "app"."address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"address" text NOT NULL,
	"region" text,
	"lat" double precision,
	"lng" double precision,
	"coords_source" "app"."coords_source",
	"floor" text,
	"place" text,
	"access_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "address_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "address_client_id_uq" UNIQUE("tenant_id","client_id","id"),
	CONSTRAINT "address_lat_ck" CHECK ("app"."address"."lat" between -90 and 90),
	CONSTRAINT "address_lng_ck" CHECK ("app"."address"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "app"."app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"language" "app"."language" DEFAULT 'en' NOT NULL,
	"status" "app"."user_status" DEFAULT 'invited' NOT NULL,
	"password_hash" text,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "app_user_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	CONSTRAINT "audit_log_actor_ck" CHECK (("app"."audit_log"."actor" = 'user') = ("app"."audit_log"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."auth_session" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "app"."auth_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"kind" "app"."token_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "app"."client_type" NOT NULL,
	"name" text NOT NULL,
	"reg_number" text,
	"legal_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "client_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."consumption_reset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid NOT NULL,
	"water_total_l" numeric(14, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"serial" text NOT NULL,
	"imei" text,
	"water_source" "app"."water_source" NOT NULL,
	"variant" "app"."variant" NOT NULL,
	"carbonated" boolean NOT NULL,
	"sku" text,
	"hw" text,
	"lifecycle" "app"."lifecycle" DEFAULT 'stock' NOT NULL,
	"ownership" "app"."ownership" DEFAULT 'purchase' NOT NULL,
	"client_id" uuid,
	"address_id" uuid,
	"esim_profile_id" uuid,
	"description" text,
	"blocked_at" timestamp with time zone,
	"blocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "device_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "device_device_id_ck" CHECK ("app"."device"."device_id" ~ '^[A-Za-z0-9._:-]{1,128}$'),
	CONSTRAINT "device_imei_ck" CHECK ("app"."device"."imei" ~ '^[0-9]{15}$'),
	CONSTRAINT "device_address_ck" CHECK ("app"."device"."address_id" is null or "app"."device"."client_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."device_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid,
	"field" "app"."history_field" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "app"."end_user_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."error_code" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"severity" "app"."severity" DEFAULT 'warning' NOT NULL,
	"action" text,
	CONSTRAINT "error_code_ck" CHECK ("app"."error_code"."code" ~ '^(B[1-3]|C[A-Za-z0-9_]{1,31})$')
);
--> statement-breakpoint
CREATE TABLE "app"."esim_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" "app"."esim_op_type" NOT NULL,
	"status" "app"."esim_op_status" DEFAULT 'requested' NOT NULL,
	"provider_ticket" text,
	"provider_date" date,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"verified_at" timestamp with time zone,
	CONSTRAINT "esim_operation_confirm_ck" CHECK (("app"."esim_operation"."status" = 'requested') or ("app"."esim_operation"."provider_ticket" is not null and "app"."esim_operation"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."esim_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"iccid" text NOT NULL,
	"eid" text,
	"imsi" text,
	"msisdn" text,
	"imei" text,
	"apn" text,
	"carrier" text,
	"tariff" text,
	"traffic_limit_mb" integer,
	"status" "app"."esim_status" DEFAULT 'inventory' NOT NULL,
	"contract_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "esim_profile_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "esim_profile_iccid_ck" CHECK ("app"."esim_profile"."iccid" ~ '^[0-9]{18,22}$')
);
--> statement-breakpoint
CREATE TABLE "app"."filter_install" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_by" uuid,
	"nominal_l" numeric(10, 1) NOT NULL,
	"water_total_l" numeric(14, 3) NOT NULL,
	"replace_by" timestamp with time zone,
	"command_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"alert_id" uuid,
	"device_id" uuid,
	"text" text NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."role_assignment" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"role" "app"."role" NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignment_sig_ck" CHECK (("app"."role_assignment"."role" = 'sig_admin') = ("app"."role_assignment"."tenant_id" is null))
);
--> statement-breakpoint
CREATE TABLE "app"."schedule_local_report" (
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"local_version" text NOT NULL,
	"version" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_local_report_pk" PRIMARY KEY("device_id","local_version")
);
--> statement-breakpoint
CREATE TABLE "app"."schedule_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"timezone" text NOT NULL,
	"content" text NOT NULL,
	"source" "app"."schedule_source" NOT NULL,
	"local_version" text,
	"changed_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_version_ck" CHECK ("app"."schedule_version"."version" > 0),
	CONSTRAINT "schedule_version_source_ck" CHECK (("app"."schedule_version"."source" = 'local') = ("app"."schedule_version"."local_version" is not null)),
	CONSTRAINT "schedule_version_content_ck" CHECK (length("app"."schedule_version"."content") <= 1024)
);
--> statement-breakpoint
CREATE TABLE "app"."setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_value_ck" CHECK ("app"."setting"."value" <> 'null'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "app"."setting_default" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenant_code_ck" CHECK ("app"."tenant"."code" ~ '^[a-z0-9-]{2,32}$')
);
--> statement-breakpoint
ALTER TABLE "app"."address" ADD CONSTRAINT "address_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."address" ADD CONSTRAINT "address_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "app"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."app_user" ADD CONSTRAINT "app_user_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_session" ADD CONSTRAINT "auth_session_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_session" ADD CONSTRAINT "auth_session_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_session" ADD CONSTRAINT "auth_session_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_token" ADD CONSTRAINT "auth_token_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_token" ADD CONSTRAINT "auth_token_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_token" ADD CONSTRAINT "auth_token_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."client" ADD CONSTRAINT "client_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_reset" ADD CONSTRAINT "consumption_reset_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_reset" ADD CONSTRAINT "consumption_reset_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_reset" ADD CONSTRAINT "consumption_reset_by_fk" FOREIGN KEY ("tenant_id","by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contact" ADD CONSTRAINT "contact_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contact" ADD CONSTRAINT "contact_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "app"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device" ADD CONSTRAINT "device_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device" ADD CONSTRAINT "device_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "app"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device" ADD CONSTRAINT "device_address_fk" FOREIGN KEY ("tenant_id","client_id","address_id") REFERENCES "app"."address"("tenant_id","client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device" ADD CONSTRAINT "device_esim_fk" FOREIGN KEY ("tenant_id","esim_profile_id") REFERENCES "app"."esim_profile"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device" ADD CONSTRAINT "device_blocked_by_fk" FOREIGN KEY ("tenant_id","blocked_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device_history" ADD CONSTRAINT "device_history_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device_history" ADD CONSTRAINT "device_history_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."device_history" ADD CONSTRAINT "device_history_by_fk" FOREIGN KEY ("tenant_id","by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."end_user_access" ADD CONSTRAINT "end_user_access_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."end_user_access" ADD CONSTRAINT "end_user_access_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."end_user_access" ADD CONSTRAINT "end_user_access_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "app"."client"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."end_user_access" ADD CONSTRAINT "end_user_access_bound_by_fk" FOREIGN KEY ("tenant_id","bound_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."esim_operation" ADD CONSTRAINT "esim_operation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."esim_operation" ADD CONSTRAINT "esim_operation_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "app"."esim_profile"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."esim_operation" ADD CONSTRAINT "esim_operation_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."esim_operation" ADD CONSTRAINT "esim_operation_confirmed_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."esim_profile" ADD CONSTRAINT "esim_profile_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."filter_install" ADD CONSTRAINT "filter_install_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."filter_install" ADD CONSTRAINT "filter_install_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."filter_install" ADD CONSTRAINT "filter_install_by_fk" FOREIGN KEY ("tenant_id","installed_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification" ADD CONSTRAINT "notification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification" ADD CONSTRAINT "notification_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification" ADD CONSTRAINT "notification_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_assigned_by_app_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "app"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_local_report" ADD CONSTRAINT "schedule_local_report_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_local_report" ADD CONSTRAINT "schedule_local_report_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_version" ADD CONSTRAINT "schedule_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_version" ADD CONSTRAINT "schedule_version_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_version" ADD CONSTRAINT "schedule_version_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."setting" ADD CONSTRAINT "setting_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."setting" ADD CONSTRAINT "setting_key_setting_default_key_fk" FOREIGN KEY ("key") REFERENCES "app"."setting_default"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."setting" ADD CONSTRAINT "setting_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "app"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."setting" ADD CONSTRAINT "setting_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_client_ix" ON "app"."address" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_uq" ON "app"."app_user" USING btree (lower("email")) WHERE "app"."app_user"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "app_user_tenant_ix" ON "app"."app_user" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_at_ix" ON "app"."audit_log" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "auth_session_user_ix" ON "app"."auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_tenant_ix" ON "app"."client" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "consumption_reset_device_ix" ON "app"."consumption_reset" USING btree ("device_id","at");--> statement-breakpoint
CREATE INDEX "contact_client_ix" ON "app"."contact" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_device_id_uq" ON "app"."device" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_serial_uq" ON "app"."device" USING btree ("tenant_id","serial") WHERE "app"."device"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_imei_uq" ON "app"."device" USING btree ("imei") WHERE "app"."device"."deleted_at" is null and "app"."device"."imei" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_esim_uq" ON "app"."device" USING btree ("esim_profile_id") WHERE "app"."device"."deleted_at" is null and "app"."device"."esim_profile_id" is not null;--> statement-breakpoint
CREATE INDEX "device_client_ix" ON "app"."device" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "device_history_device_ix" ON "app"."device_history" USING btree ("device_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "end_user_access_uq" ON "app"."end_user_access" USING btree ("user_id","client_id") WHERE "app"."end_user_access"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "esim_operation_profile_ix" ON "app"."esim_operation" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "esim_profile_iccid_uq" ON "app"."esim_profile" USING btree ("iccid") WHERE "app"."esim_profile"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "filter_install_device_ix" ON "app"."filter_install" USING btree ("device_id","installed_at");--> statement-breakpoint
CREATE INDEX "notification_user_ix" ON "app"."notification" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_version_uq" ON "app"."schedule_version" USING btree ("device_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_version_local_uq" ON "app"."schedule_version" USING btree ("device_id","local_version") WHERE "app"."schedule_version"."local_version" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "setting_tenant_uq" ON "app"."setting" USING btree ("tenant_id","key") WHERE "app"."setting"."device_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "setting_device_uq" ON "app"."setting" USING btree ("device_id","key") WHERE "app"."setting"."device_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_code_uq" ON "app"."tenant" USING btree ("code");