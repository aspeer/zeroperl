import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { webdyneRuntimeConfig } from "../js/runtime/config.js";
import { generatedWranglerConfig, main } from "../scripts/webdyne-cloudflare.mjs";

test("callback bindings become fixed application configuration", () => {
  const config = webdyneRuntimeConfig({WEBDYNE_STARTUP: "My::App::startup", WEBDYNE_SHUTDOWN: "My::App::shutdown"});
  assert.equal(config.startup, "My::App::startup");
  assert.equal(config.shutdown, "My::App::shutdown");
  for (const value of [null, 0, "", "startup", "My::App::startup()", "My::App; die", "My/App::startup", "My::App::startup\n"]) {
    assert.throws(() => webdyneRuntimeConfig({WEBDYNE_STARTUP: value}), /qualified Perl function name/);
    assert.throws(() => webdyneRuntimeConfig({WEBDYNE_SHUTDOWN: value}), /qualified Perl function name/);
  }
});

test("scaffold emits both callbacks and preserves explicit Wrangler config", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifespan-config-"));
  try {
    await mkdir(join(root, ".webdyne"));
    const project = {packageJson: {name: "callbacks"}, webdyne: {lifespan: {startup: "My::App::startup", shutdown: "My::App::shutdown"}}, cloudflare: {}};
    const output = await generatedWranglerConfig(root, project, {entry: "app.psp"}, join(root, ".webdyne"));
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(config.vars.WEBDYNE_STARTUP, "My::App::startup");
    assert.equal(config.vars.WEBDYNE_SHUTDOWN, "My::App::shutdown");
    const supplied = '{"name":"unchanged"}\n';
    await writeFile(join(root, "wrangler.jsonc"), supplied);
    assert.equal(await generatedWranglerConfig(root, project, {entry: "app.psp"}, join(root, ".webdyne")), join(root, "wrangler.jsonc"));
    assert.equal(await readFile(join(root, "wrangler.jsonc"), "utf8"), supplied);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("CLI rejects malformed callback configuration before building", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifespan-invalid-"));
  try {
    for (const lifespan of [{startup: "My::App::startup()"}, {startpu: "My::App::startup"}, [], null]) {
      await writeFile(join(root, "package.json"), JSON.stringify({name: "callbacks", webdyne: {lifespan}}));
      await assert.rejects(main(["build"], root), /lifespan/);
    }
  } finally { await rm(root, {recursive: true, force: true}); }
});
