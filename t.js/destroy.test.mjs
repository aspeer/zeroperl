import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { main, confirmDestroy } from "../scripts/webdyne-cloudflare.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "webdyne-destroy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "destroy-test" }));
  return root;
}

test("destroy requires full Yes; blank, no and other answers cancel", async () => {
  for (const [answer, expected] of [["Yes", true], ["YES", true], ["", false], ["No", false], ["y", false], ["something", false]]) {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = output.isTTY = true;
    const result = confirmDestroy("Delete test Worker?", input, output);
    input.write(`${answer}\n`);
    assert.equal(await result, expected);
    input.destroy(); output.destroy();
  }
});

test("destroy refuses non-interactive input", async () => {
  await assert.rejects(confirmDestroy("Delete?", new PassThrough(), new PassThrough()), /interactive terminal/);
});

test("cancelled destroy never calls Wrangler or builds the app", async (t) => {
  const root = await fixture(t);
  await main(["destroy"], root, () => assert.fail("Wrangler called"), async () => false);
  await assert.rejects(readFile(join(root, ".webdyne/worker.js")), { code: "ENOENT" });
});

test("confirmed destroy uses deployment configuration and forwards environment without building", async (t) => {
  const root = await fixture(t);
  const calls = [];
  await main(["destroy", "--", "--env", "staging"], root, async (args) => calls.push(args), async (message) => {
    assert.match(message, /staging/); return true;
  });
  assert.equal(calls[0][0], "delete");
  assert.equal(calls[0][1], "--config");
  assert.deepEqual(calls[0].slice(-2), ["--env", "staging"]);
  assert.ok(!calls[0].includes("--force"));
  const config = JSON.parse(await readFile(calls[0][2]));
  assert.equal(config.name, "destroy-test");
  await assert.rejects(readFile(join(root, ".webdyne/worker.js")), { code: "ENOENT" });
  await writeFile(join(root, "custom.jsonc"), '{"name":"custom-worker"}');
  await main(["destroy", "--wrangler-config", "custom.jsonc"], root, async (args) => calls.push(args), async () => true);
  assert.ok(calls[1][2].endsWith("custom.jsonc"));
});

test("destroy rejects force bypass; init adds destroy to existing projects", async (t) => {
  const root = await fixture(t);
  for (const arg of ["--force", "--force=true", "--yes", "-y"]) {
    await assert.rejects(main(["destroy", "--", arg], root, () => assert.fail("Wrangler called"), () => assert.fail("Prompt called")), /bypass/);
  }
  await main(["init"], root);
  assert.equal(JSON.parse(await readFile(join(root, "package.json"))).scripts.destroy, "webdyne-cloudflare destroy");
});
