import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { clientKey, normalizeQuery } from "./demand";

const req = (header: string | undefined, ip = "203.0.113.9") => ({ get: () => header, ip }) as unknown as Request;

test("identifies people by app install ID, falling back to network address", () => {
  assert.equal(clientKey(req("3f2a9c1e-77aa-4b1c-9d2e-0123456789ab")), "app:3f2a9c1e-77aa-4b1c-9d2e-0123456789ab");
  assert.equal(clientKey(req(undefined)), "ip:203.0.113.9");
  assert.equal(clientKey(req("bad id; drop table")), "ip:203.0.113.9", "malformed IDs are ignored");
});

test("normalizes queries so the same request from different people lines up", () => {
  assert.equal(normalizeQuery("  Rhode   Peptide Lip "), "rhode peptide lip");
  assert.equal(normalizeQuery("RHODE"), normalizeQuery("rhode"));
});
