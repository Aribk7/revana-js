const { test } = require("node:test");
const assert = require("node:assert/strict");
test("CommonJS require works", () => {
  const { Revana, DEFAULT_BASE_URL } = require("../dist/cjs/index.js");
  assert.equal(typeof Revana, "function");
  assert.equal(DEFAULT_BASE_URL, "https://api.revana.si");
});
