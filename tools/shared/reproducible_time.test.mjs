import assert from "node:assert/strict";
import test from "node:test";
import { generationTimestamp } from "./reproducible_time.mjs";

test("SOURCE_DATE_EPOCH fixes generation time to an exact UTC second", () => {
  assert.equal(
    generationTimestamp({ SOURCE_DATE_EPOCH: "1767225600" }),
    "2026-01-01T00:00:00Z",
  );
});

test("wall-clock time remains the default outside reproducible builds", () => {
  assert.equal(generationTimestamp({}, 1_767_225_600_999), "2026-01-01T00:00:00Z");
});

test("invalid reproducible timestamps fail clearly", () => {
  assert.throws(
    () => generationTimestamp({ SOURCE_DATE_EPOCH: "yesterday" }),
    /non-negative integer/,
  );
  assert.throws(
    () => generationTimestamp({ SOURCE_DATE_EPOCH: "999999999999999" }),
    /supported date range/,
  );
});
