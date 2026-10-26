import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesBrandListFilters,
  matchesProjectListFilters,
} from "../src/lib/caseListFilters.ts";

const filters = {
  industry: "",
  furniture: "",
  priceMin: "",
  priceMax: "",
  dateFrom: "",
  dateTo: "",
  brand: "",
};

test("project filters combine industry, furniture, amount, date and brand", () => {
  const row = {
    industries: ["教育 - Education"],
    furniture_types: ["學校家具"],
    estimated_income: 24000,
    signed_date: "2026-10-23T00:00:00.000Z",
    famous_brand: "Beacon",
  };
  assert.equal(matchesProjectListFilters(row, filters), true);
  assert.equal(
    matchesProjectListFilters(row, { ...filters, industry: "金融" }),
    false,
  );
  assert.equal(
    matchesProjectListFilters(row, { ...filters, priceMin: "30000" }),
    false,
  );
  assert.equal(
    matchesProjectListFilters(row, { ...filters, dateFrom: "2026-10-24" }),
    false,
  );
  assert.equal(
    matchesProjectListFilters(row, { ...filters, brand: "Other" }),
    false,
  );
  assert.equal(
    matchesProjectListFilters(row, { ...filters, brand: "Other" }, { brand: false }),
    true,
  );
});

test("brand filters skip the famous-brand picker and match one related project", () => {
  const brand = {
    industries: ["教育 - Education"],
    filter_projects: [
      {
        signed_date: "2026-01-02T00:00:00.000Z",
        estimated_income: 1000,
        furniture_types: ["沙發"],
      },
      {
        signed_date: "2026-10-23T00:00:00.000Z",
        estimated_income: 24000,
        furniture_types: ["學校家具"],
      },
    ],
  };
  assert.equal(
    matchesBrandListFilters(brand, {
      ...filters,
      furniture: "學校家具",
      priceMin: "20000",
      dateFrom: "2026-10-01",
    }),
    true,
  );
  assert.equal(
    matchesBrandListFilters(brand, {
      ...filters,
      furniture: "沙發",
      priceMin: "20000",
    }),
    false,
  );
});
