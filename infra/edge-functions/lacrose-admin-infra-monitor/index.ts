import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import postgres from "npm:postgres@3.4.7";

const origin = "https://lacrosetecnologia.com.br";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Vary": "Origin",
};
const baseHeaders = {
  ...cors,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const reply = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: baseHeaders });

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const sql = dbUrl
  ? postgres(dbUrl, { max: 1, prepare: false, ssl: "require", connect_timeout: 5, idle_timeout: 10 })
  : null;

const timeout = (ms: number) => AbortSignal.timeout(ms);
async function githubRepo(repo: string, token: string | undefined) {
  try {
    const response = await fetch("https://api.github.com/repos/igorlacrose/" + repo, {
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "lacrose-admin-infrastructure-monitor",
        ...(token ? { "Authorization": "Bearer " + token } : {}),
      },
      signal: timeout(6500),
    });
    if (!response.ok) {
      return { name: "igorlacrose/" + repo, status: "unavailable", size_bytes: null };
    }
    const item = await response.json();
    const size = Number(item?.size);
    if (item?.full_name !== "igorlacrose/" + repo || !Number.isFinite(size) || size < 0) {
      return { name: "igorlacrose/" + repo, status: "unavailable", size_bytes: null };
    }
    return {
      name: item.full_name,
      status: "ok",
      visibility: item.private ? "private" : "public",
      size_bytes: Math.round(size * 1024),
      measure: "github_repository_size_approx",
    };
  } catch {
    return { name: "igorlacrose/" + repo, status: "unavailable", size_bytes: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("Origin") && req.headers.get("Origin") !== origin) {
    return reply({ error: "origin_not_allowed" }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "GET") return reply({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token) return reply({ error: "authentication_required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  let key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  try {
    key = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || key;
  } catch { /* only use the built-in fallback */ }
  if (!url || !key) return reply({ error: "monitor_unavailable" }, 503);

  const sb = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await sb.auth.getUser(token);
  if (authError || !authData?.user) return reply({ error: "authentication_required" }, 401);

  const { data: profile, error: profileError } = await sb.from("profiles")
    .select("role,active").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile?.active || !["master", "admin"].includes(profile.role)) {
    return reply({ error: "forbidden" }, 403);
  }

  let siteSupabase: Record<string, unknown> = { status: "unavailable" };
  if (sql) {
    try {
      const rows = await sql`
        SELECT
          pg_database_size(current_database())::bigint AS database_bytes,
          (SELECT COALESCE(SUM(
            CASE WHEN metadata->>'size' ~ '^[0-9]{1,16}$'
                 THEN (metadata->>'size')::bigint ELSE 0 END
          ),0)::bigint FROM storage.objects) AS storage_objects_bytes
      `;
      siteSupabase = {
        status: "ok",
        database_bytes: Number(rows[0].database_bytes),
        storage_objects_bytes: Number(rows[0].storage_objects_bytes),
        source: "postgres_readonly_query",
      };
    } catch {
      siteSupabase = { status: "unavailable" };
    }
  }

  const ghToken = Deno.env.get("LACROSE_MONITOR_GITHUB_TOKEN") || undefined;
  const [siteRepo, edgeRepo] = await Promise.all([
    githubRepo("lacrosetecnologia", ghToken),
    githubRepo("lcs-edge", ghToken),
  ]);

  return reply({
    sampled_at: new Date().toISOString(),
    site_supabase: siteSupabase,
    lkz_supabase: { status: "not_connected", reason: "cross_project_monitoring_not_configured" },
    github: [siteRepo, edgeRepo],
    github_quotas: { status: "not_connected", reason: "lfs_actions_billing_require_separate_authorized_source" },
    notes: ["GitHub repository size is not available storage quota.", "Free plan limits are reference values, not measured account quotas."],
  });
});
