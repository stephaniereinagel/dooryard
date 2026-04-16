// Homestead Ops — app-level configuration.
// Set these once per deployment so users only sign in (no backend config in the UI).
//
// You can reuse the same Supabase project as the kid-pay-app — the schema is scoped
// to its own tables (workspaces, workspace_members, whiteboard_items, backlog_items,
// shift_logs) and won't collide.

window.HOMESTEAD_OPS_CONFIG = {
  // Example: "https://your-project-id.supabase.co"
  supabaseUrl: "https://cawhopaiqybrnjalwqci.supabase.co",

  // Example: "eyJhbGciOi..."
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhd2hvcGFpcXlicm5qYWx3cWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTg1OTcsImV4cCI6MjA4ODgzNDU5N30.uAub_usXzjeGQ0Zgv9Rf4GBWFVrZbh_JYhQUAYD-zB0",

  // Name used for the auto-created first workspace (you can rename in-app later).
  defaultWorkspaceName: "Reinagel Homestead",

  // Quick-links shown in the Today view
  links: {
    myGardenCoach: "https://mygardencoach.netlify.app",
    farmStandFacebook: "" // fill in your FB page URL when ready
  }
};
