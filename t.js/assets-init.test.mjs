import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "fflate";
import { unpackTar } from "modern-tar";
import { main } from "../scripts/webdyne-cloudflare.mjs";
import { defaultAssetsIgnore, readAssetsPolicy } from "../scripts/assets.mjs";

async function fixture(t, webdyne = {}) {
  const root = await mkdtemp(join(tmpdir(), "webdyne-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = webdyne.appDirectory ?? "app";
  await mkdir(join(root, app), { recursive: true });
  await writeFile(join(root, app, webdyne.entry ?? "app.psp"), "<html>hello</html>\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "example", webdyne }));
  return realpath(root);
}

async function names(root, output = ".webdyne") {
  const entries = await unpackTar(gunzipSync(await readFile(join(root, output, "app-vfs.tar.gz"))));
  return entries.map(({ header }) => header.name.replace(/\/$/, "")).sort();
}

test("init creates Scratch defaults, retains scripts and metadata, and is repeatable", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "existing", description: "keep me", dependencies: { example: "1.0.0" },
    scripts: { test: "custom-test", dev: "custom-dev" },
    webdyne: { static: true, cloudflare: { name: "existing-worker" } },
  }));
  await writeFile(join(root, ".gitignore"), "existing\n");
  await main(["init"], root);
  const json = JSON.parse(await readFile(join(root, "package.json")));
  assert.equal(json.description, "keep me");
  assert.equal(json.dependencies.example, "1.0.0");
  assert.equal(json.scripts.dev, "custom-dev");
  assert.equal(json.scripts.test, "custom-test");
  for (const command of ["build", "check", "deploy", "login", "logout", "whoami"]) {
    assert.equal(json.scripts[command], `webdyne-cloudflare ${command}`);
  }
  assert.equal(json.webdyne.static, false);
  assert.equal(json.webdyne.cloudflare.name, "existing-worker");
  assert.equal(await readFile(join(root, "app/.assetsignore"), "utf8"), defaultAssetsIgnore);
  const before = await Promise.all(["package.json", ".gitignore", "app/.assetsignore"].map((file) => readFile(join(root, file), "utf8")));
  await main(["init"], root);
  assert.deepEqual(await Promise.all(["package.json", ".gitignore", "app/.assetsignore"].map((file) => readFile(join(root, file), "utf8"))), before);
});

test("custom source, entry, output and configuration survive initialization", async (t) => {
  const root = await fixture(t, { appDirectory: "site files", entry: "home.psp" });
  await writeFile(join(root, "site files/.assetsignore"), "*.psp\nprivate/\n");
  await main(["init", "--output", "generated", "--wrangler-config", "custom.jsonc"], root);
  const json = JSON.parse(await readFile(join(root, "package.json")));
  assert.equal(json.webdyne.appDirectory, "site files");
  assert.equal(json.webdyne.entry, "home.psp");
  assert.equal(json.webdyne.outputDirectory, "generated");
  assert.equal(json.webdyne.cloudflare.wranglerConfig, "custom.jsonc");
  assert.equal(await readFile(join(root, "site files/.assetsignore"), "utf8"), "*.psp\nprivate/\n");
  await main(["build"], root);
  assert.ok((await names(root, "generated")).includes("app/home.psp"));
  await main(["init", "--output", ".webdyne"], root);
  assert.equal(JSON.parse(await readFile(join(root, "package.json"))).webdyne.outputDirectory, ".webdyne");
});

test("asset selection follows root gitignore rules and is recomputed on each build", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "app/nested/private"), { recursive: true });
  await mkdir(join(root, "app/private"));
  for (const file of ["nested/handler.psp", "nested/photo.png", "nested/private/data.txt", "private/data.txt", "example.pm", "public.pm", "root.txt", "nested/root.txt", "_headers", "_redirects"]) {
    await writeFile(join(root, "app", file), file);
  }
  await writeFile(join(root, "app/.assetsignore"), "# server files\n*.psp\n*.pm\n!public.pm\n/private/\n/root.txt\n");
  await main(["build"], root);
  const first = await names(root);
  for (const file of ["app/app.psp", "app/nested/handler.psp", "app/example.pm", "app/private/data.txt", "app/root.txt", "app/_headers", "app/_redirects"]) assert.ok(first.includes(file), file);
  for (const file of ["app/nested/photo.png", "app/nested/private/data.txt", "app/public.pm", "app/nested/root.txt"]) assert.ok(!first.includes(file), file);
  await writeFile(join(root, "app/.assetsignore"), "*.psp\n*.png\n");
  await main(["build"], root);
  assert.ok((await names(root)).includes("app/nested/photo.png"));
  assert.ok(!(await names(root)).includes("app/example.pm"));
  await rm(join(root, "app/.assetsignore"));
  await main(["build"], root);
  assert.ok((await names(root)).includes("app/example.pm"));
});

test("check, dev and both deploy stages get the detected assets root once", async (t) => {
  const root = await fixture(t, { appDirectory: "site files" });
  await main(["init"], root);
  for (const command of ["check", "dev", "deploy"]) {
    const calls = [];
    await main([command], root, async (args) => calls.push(args));
    assert.equal(calls.length, command === "deploy" ? 2 : 1);
    for (const args of calls) {
      assert.equal(args.filter((arg) => arg === "--assets").length, 1);
      assert.equal(args[args.indexOf("--assets") + 1], join(root, "site files"));
    }
  }
  const config = JSON.parse(await readFile(join(root, ".webdyne/wrangler.jsonc")));
  assert.equal(config.vars.WEBDYNE_STATIC, "0");
  for (const flags of [["--assets", "./site files"], ["--assets=./site files"]]) {
    const calls = [];
    await main(["dev", "--", ...flags], root, async (args) => calls.push(args));
    assert.deepEqual(calls[0].slice(-flags.length), flags);
    assert.equal(calls[0].filter((arg) => arg.startsWith("--assets")).length, 1);
  }
});

test("explicit assets subdirectory leaves the rest of the application in VFS", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "app/public"));
  await writeFile(join(root, "app/public/.assetsignore"), "private.txt\n");
  await writeFile(join(root, "app/public/private.txt"), "private");
  await writeFile(join(root, "app/public/site.css"), "body {}");
  await main(["check", "--", "--assets", "app/public"], root, async () => {});
  assert.ok((await names(root)).includes("app/app.psp"));
  assert.ok((await names(root)).includes("app/public/private.txt"));
  assert.ok(!(await names(root)).includes("app/public/site.css"));
});

test("without an ignore file the legacy VFS and Wrangler arguments are preserved", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "app/site.css"), "body {}");
  const calls = [];
  await main(["dev"], root, async (args) => calls.push(args));
  assert.ok((await names(root)).includes("app/site.css"));
  assert.ok(!calls[0].includes("--assets"));
});

test("misplaced ignore files and public entry pages fail with actionable errors", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "app/.assetignore"), "*.psp");
  await assert.rejects(main(["init"], root), /plural/);
  await rm(join(root, "app/.assetignore"));
  await mkdir(join(root, "app/nested"));
  await writeFile(join(root, "app/nested/.assetsignore"), "*.psp");
  await assert.rejects(main(["build"], root), /only reads.*root-relative/);
  await rm(join(root, "app/nested/.assetsignore"));
  await writeFile(join(root, "app/.assetsignore"), "*.css");
  await assert.rejects(main(["build"], root), /entry app.psp would be public/);
  await assert.rejects(main(["init", "--output", "app/generated"], root), /outside the assets/);
});

test("directory patterns and negations agree with gitignore parent-directory semantics", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "app/.assetsignore"), "private/\n!private/open.txt\n*.psp\n");
  const policy = await readAssetsPolicy(join(root, "app"));
  assert.equal(policy.isPublic(join(root, "app/private/open.txt")), false);
  assert.equal(policy.isPublic(join(root, "app/nested/private/data.txt")), false);
  assert.equal(policy.isPublic(join(root, "app/nested/app.psp")), false);
  assert.equal(policy.isPublic(join(root, "app/site.css")), true);
  assert.equal(policy.isPublic(join(root, "outside.txt")), false);
});

test("initialization rejects application symlinks outside the project", async (t) => {
  const root = await fixture(t);
  const other = await fixture(t);
  await symlink(join(other, "app"), join(root, "escape"));
  await assert.rejects(main(["init", "--app-directory", "escape"], root), /symlink escapes/);
});

test("authentication uses bundled Wrangler without requiring a project or building", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "webdyne-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const command of ["login", "logout", "whoami"]) {
    const calls = [];
    await main([command, "--", "--help"], root, async (args) => calls.push(args));
    assert.deepEqual(calls, [[command, "--help"]]);
  }
});
