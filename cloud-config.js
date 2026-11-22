// Enable only after creating a dedicated "Сделано" Supabase project,
// applying supabase/sdelano_sync_v1.sql and configuring Auth redirect URLs.
// For existing installations, apply supabase/sdelano_sync_v2_upgrade.sql
// before enabling wallet sync. Database-side downgrade protection is required.
// Use the PUBLIC publishable key only. Never paste service_role/secret keys here.
window.SDELANO_CLOUD_CONFIG = Object.freeze({
  url: "",
  publishableKey: ""
});
