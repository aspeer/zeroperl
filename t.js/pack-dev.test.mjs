import assert from "node:assert/strict";
import test from "node:test";
import { developmentVersion } from "../tools/pack-dev.mjs";

test("local versions target the next patch without changing the runtime release", () => {
  assert.equal(developmentVersion("1.0.3", "abcdef0123456789", new Date("2026-09-07T04:05:06.007Z")),
    "1.0.4-dev.20260907040506007.gabcdef012345");
  assert.equal(developmentVersion("2.1.9", "abcdef0123456789", new Date("2026-09-07T04:05:06.008Z")),
    "2.1.10-dev.20260907040506008.gabcdef012345");
  assert.throws(() => developmentVersion("1.0.3-dev.1", "abc"), /stable/);
  assert.throws(() => developmentVersion("../1.0.3", "abc"), /stable/);
});
