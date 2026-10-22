import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchCaseShowcase,
  CaseAccessError,
} from "../supabase/functions/_shared/caseShowcase.ts";

const user = {
  id: "auth-1",
  email: "staff@example.com",
  email_confirmed_at: "2026-01-01",
};
function database({
  role = "User",
  staff = true,
  permission = true,
  failTable,
  tables = {},
} = {}) {
  const calls = [];
  const data = {
    users: staff
      ? [
          {
            id: "u1",
            auth_user_id: "auth-1",
            email: user.email,
            member_id: "s1",
          },
        ]
      : [],
    staff: [
      { id: "s1", name: "PM", role, status: "Active", n_team_type_id: "team1" },
    ],
    bwf_projects: [
      {
        id: "p1",
        project_code: "P1",
        main_pm_id: "s1",
        n_team_type_id: "other",
        completion_photos: "//example.com/a.jpg",
        modified_date: "2026-01-01",
      },
      {
        id: "p2",
        project_code: "P2",
        n_team_type_id: "team1",
        completion_photos: "//example.com/b.jpg",
        modified_date: "2026-02-01",
      },
      { id: "p3", project_code: "P3", n_team_type_id: "other" },
    ],
    project_bv: [{ id: "bv1", handler_id: "s1", bwf_project_id: "p1" }],
    bwf_orders: [
      { id: "o1", bwf_project_id: "p1", quantity: 0 },
      { id: "o2", bwf_project_id: "p2", quantity: 4 },
      { id: "o3", bwf_project_id: "p3" },
    ],
    ...tables,
  };
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: permission, error: null });
    },
    from(table) {
      calls.push({ table });
      let result = [...(data[table] || [])];
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          result = result.filter((r) => r[key] === value);
          return query;
        },
        ilike(key, value) {
          result = result.filter(
            (r) => r[key]?.toLowerCase() === value.toLowerCase(),
          );
          return query;
        },
        in(key, values) {
          result = result.filter((r) => values.includes(r[key]));
          return query;
        },
        not(key) {
          result = result.filter((r) => r[key] != null);
          return query;
        },
        order(key) {
          result.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
          return query;
        },
        range(start, end) {
          result = result.slice(start, end + 1);
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: result,
            error:
              table === failTable ? { message: "database unavailable" } : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("PMS identity is required before reading business data", async () => {
  const db = database({ staff: false });
  await assert.rejects(
    fetchCaseShowcase(db, user, "cases-orders"),
    CaseAccessError,
  );
  assert.equal(
    db.calls.some((c) => c.table === "bwf_orders"),
    false,
  );
});
test("PMS page denial cannot be bypassed by an FDS role", async () => {
  const db = database({ permission: false, role: "Admin" });
  await assert.rejects(
    fetchCaseShowcase(db, user, "cases-photos"),
    CaseAccessError,
  );
  assert.equal(
    db.calls.some((c) => c.table === "bwf_projects"),
    false,
  );
});
test("User sees only assigned orders, preserving zero quantities and unknown relations", async () => {
  const db = database();
  const { items } = await fetchCaseShowcase(db, user, "cases-orders");
  assert.deepEqual(
    items.map((r) => r.id),
    ["o1"],
  );
  assert.equal(items[0].quantity, 0);
  assert.equal(items[0].product_name, null);
  assert.equal(
    db.calls.find((c) => c.name === "check_permission").args.p_module,
    "bwf/projects",
  );
});
test("Senior User sees assigned plus same-team photos, no unrelated projects", async () => {
  const { items } = await fetchCaseShowcase(
    database({ role: "Senior User" }),
    user,
    "cases-photos",
  );
  assert.deepEqual(items.map((p) => p.id).sort(), ["p1", "p2"]);
});
test("Admin order data is not truncated at 1000 rows", async () => {
  const orders = Array.from({ length: 1233 }, (_, i) => ({
    id: `order-${String(i).padStart(5, "0")}`,
    bwf_project_id: "p1",
  }));
  const { items } = await fetchCaseShowcase(
    database({ role: "Admin", tables: { bwf_orders: orders } }),
    user,
    "cases-orders",
  );
  assert.equal(items.length, 1233);
  assert.equal(new Set(items.map((r) => r.id)).size, 1233);
});
test("query errors are surfaced instead of returning a misleading empty list", async () => {
  await assert.rejects(
    fetchCaseShowcase(
      database({ failTable: "project_bv" }),
      user,
      "cases-orders",
    ),
    /database unavailable/,
  );
});
test("brands use exact well-known tag, Active state, and normalized project junctions", async () => {
  const tag = "63175251-2c31-46e6-b107-cbe0140983d8";
  const db = database({
    tables: {
      customer_tags: [
        { id: "t1", customer_uuid: "c1", tag_uuid: tag },
        { id: "t2", customer_uuid: "c2", tag_uuid: tag },
        { id: "t3", customer_uuid: "c3", tag_uuid: "unrelated" },
      ],
      customers: [
        { id: "c1", status: "Active", brand_name_cn: "Brand" },
        { id: "c2", status: "Inactive" },
        { id: "c3", status: "Active" },
      ],
      bwa_projects: [
        { id: "bwa1", customer_id: "c1", n_service_type_id: "service1" },
      ],
      bwa_project_project_types: [
        { id: "j1", project_id: "bwa1", project_type_id: "type1" },
      ],
    },
  });
  const { items } = await fetchCaseShowcase(db, user, "cases-brands");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "c1");
  assert.equal(items[0].project_count, 1);
  assert.deepEqual(items[0].project_type_ids, ["type1"]);
});
test("unverified email and ambiguous identity do not permit an email fallback", async () => {
  const db = database({
    tables: {
      users: [
        {
          id: "u2",
          auth_user_id: "another",
          email: user.email,
          member_id: "s1",
        },
      ],
    },
  });
  await assert.rejects(
    fetchCaseShowcase(
      db,
      { ...user, email_confirmed_at: undefined },
      "cases-brands",
    ),
    CaseAccessError,
  );
});
