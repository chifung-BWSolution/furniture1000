// Read-only contract smoke test. Keys stay in memory and are never printed.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchCaseShowcase } from "../supabase/functions/_shared/caseShowcase.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((s) => /^[A-Z_]+=/.test(s))
    .map((s) => {
      const i = s.indexOf("=");
      return [
        s.slice(0, i),
        s
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ];
    }),
);
const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN required");
for (const ref of ["kqwktnplkqucsbasyfjl", "alrbbyqkeobmvvvscpma"]) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/api-keys`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Key lookup failed: ${response.status}`);
  const keys = await response.json();
  const key = keys.find((k) => k.name === "service_role")?.api_key;
  if (!key) throw new Error("Service key not available");
  const db = createClient(`https://${ref}.supabase.co`, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admins, error } = await db
    .from("staff")
    .select("id")
    .eq("status", "Active")
    .in("role", ["Admin", "Super Admin"])
    .limit(20);
  if (error) throw error;
  const { data: users, error: identityError } = await db
    .from("users")
    .select("auth_user_id")
    .in(
      "member_id",
      admins.map((a) => a.id),
    )
    .not("auth_user_id", "is", null)
    .limit(1);
  if (identityError) throw identityError;
  if (!users?.[0]) throw new Error("No mapped PMS admin for contract test");
  for (const action of ["cases-orders", "cases-photos", "cases-brands"]) {
    const started = performance.now();
    try {
      const result = await fetchCaseShowcase(
        db,
        { id: users[0].auth_user_id },
        action,
      );
      console.log(
        JSON.stringify({
          ref,
          action,
          count: result.items.length,
          duration_ms: Math.round(performance.now() - started),
        }),
      );
    } catch (error) {
      console.log(JSON.stringify({ ref, action, error: error.message }));
      process.exitCode = 1;
    }
  }
}
