import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "fflate";
import { unpackTar } from "modern-tar";
import { buildApplicationArchives } from "../scripts/build-vfs.mjs";
import {
  generatedWranglerConfig,
  main as cloudflareMain,
} from "../scripts/webdyne-cloudflare.mjs";
import { createExtensionManager } from "../js/runtime/extensions.js";
import { webdyneRuntimeConfig } from "../js/runtime/config.js";
import { buildPagiScope, createFetchPagiTransport } from "../js/transport/fetch-pagi.js";

const worker = await readFile(new URL("../js/worker.js", import.meta.url), "utf8");
const provider = await readFile(new URL("../js/provider/cloudflare.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("../js/runtime/webdyne-runtime.js", import.meta.url), "utf8");
const transport = await readFile(new URL("../js/transport/fetch-pagi.js", import.meta.url), "utf8");
const packageBuilder = await readFile(new URL("../tools/prepare-npm-package.mjs", import.meta.url), "utf8");

async function archiveNames(path) {
  const entries = await unpackTar(gunzipSync(await readFile(path)), { strict: true });
  return entries.map(({ header }) => header.name.replace(/\/$/, "")).sort();
}

test("Cloudflare APIs remain outside the portable runtime and transport", () => {
  assert.match(worker, /createCloudflareWorker as createWebDyneWorker/);
  assert.match(provider, /new WebSocketPair/);
  assert.match(provider, /context\.waitUntil/);
  assert.doesNotMatch(runtime, /WebSocketPair|context\.waitUntil|wrangler/i);
  assert.doesNotMatch(transport, /new WebSocketPair|context\.waitUntil/);
  assert.doesNotMatch(`${worker}\n${provider}\n${runtime}\n${transport}`, /@aspeer\//);
});

test("the portable runtime uses the new VFS roots and temporary directory", () => {
  assert.deepEqual(webdyneRuntimeConfig({}), {
    root: "/app",
    index: "app.psp",
    static: 1,
    conf: 0,
    perlEnv: {
      PERL5LIB: "/perl5/lib",
      TMPDIR: "/tmp",
    },
  });
});

test("runtime extensions register per interpreter and clean up request scopes in reverse order", () => {
  const events = [];
  const manager = createExtensionManager([
    {
      name: "first",
      register: (perl) => events.push(`register:first:${perl.id}`),
      attachScope: ({ scope }) => {
        scope.extensions.first = true;
        events.push("attach:first");
        return () => events.push("release:first");
      },
    },
    {
      name: "second",
      register: (perl) => events.push(`register:second:${perl.id}`),
      attachScope: () => {
        events.push("attach:second");
        return { release: () => events.push("release:second") };
      },
    },
  ]);
  manager.register({ id: 7 });
  const scope = { extensions: {} };
  const release = manager.attachScope({ scope, bindings: {}, request: {} });
  assert.equal(scope.extensions.first, true);
  release();
  release();
  assert.deepEqual(events, [
    "register:first:7",
    "register:second:7",
    "attach:first",
    "attach:second",
    "release:second",
    "release:first",
  ]);
});

test("the portable Fetch transport completes an ordinary PAGI response", async () => {
  const request = new Request("https://example.test/a%20page.psp?name=WebDyne");
  const scope = buildPagiScope(request);
  assert.equal(scope.type, "http");
  assert.equal(scope.path, "/a page.psp");
  assert.equal(scope.raw_path, "/a%20page.psp");

  const transport = createFetchPagiTransport(scope, request);
  assert.deepEqual(await transport.receiveSource.next(), {
    type: "http.request",
    body_base64: "",
    more: 0,
  });
  await transport.sink.send({
    type: "http.response.start",
    status: 201,
    headers_base64: [["Y29udGVudC10eXBl", "dGV4dC9wbGFpbg=="]],
  });
  await transport.sink.send({ type: "http.response.body", body_base64: "V2ViRHluZQ==", more: 0 });
  const response = await transport.response;
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(await response.text(), "WebDyne");
});

test("the portable Fetch transport streams PAGI SSE events", async () => {
  const request = new Request("https://example.test/events.psp", {
    headers: { accept: "text/event-stream" },
  });
  const scope = buildPagiScope(request);
  assert.equal(scope.type, "sse");
  const transport = createFetchPagiTransport(scope, request);
  await transport.sink.send({ type: "sse.start", status: 200 });
  const response = await transport.response;
  const responseBody = response.text();
  await transport.sink.send({ type: "sse.send", event_base64: "dGljaw==", data_base64: "cmVhZHk=" });
  await transport.sink.send({ type: "sse.close" });
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(await responseBody, "event: tick\ndata: ready\n\n");
});

test("the npm builder packages only execution and deployment directories", () => {
  for (const directory of ["bin", "js", "lib", "scripts"]) {
    assert.match(packageBuilder, new RegExp(`resolve\\(destination, "${directory}"\\)`));
  }
  assert.match(packageBuilder, /embedded-files\.json/);
  assert.doesNotMatch(packageBuilder, /resolve\(destination, "t(?:\.js)?"\)/);
});

test("application and Pure-Perl trees receive stable VFS roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "webdyne-vfs-test-"));
  try {
    await mkdir(join(root, "app/assets"), { recursive: true });
    await mkdir(join(root, "app/node_modules/private"), { recursive: true });
    await mkdir(join(root, "local-lib"), { recursive: true });
    await writeFile(join(root, "app/app.psp"), "<html>ok</html>\n");
    await writeFile(join(root, "app/assets/site.css"), "body {}\n");
    await writeFile(join(root, "app/node_modules/private/hidden.js"), "hidden\n");
    await writeFile(join(root, "local-lib/Example.pm"), "package Example; 1;\n");
    await writeFile(join(root, "local-lib/.packlist"), "host-only metadata\n");
    const duplicate = "package Duplicate; 1;\n";
    await writeFile(join(root, "local-lib/Duplicate.pm"), duplicate);
    const duplicateHash = createHash("sha256").update(duplicate).digest("hex");

    const result = await buildApplicationArchives({
      projectRoot: root,
      appDirectory: "app",
      libraryDirectories: ["local-lib"],
      outputDirectory: join(root, ".webdyne"),
      embeddedFiles: { "Duplicate.pm": duplicateHash },
    });

    assert.deepEqual(await archiveNames(result.appVfsArchive), [
      "app",
      "app/app.psp",
      "app/assets",
      "app/assets/site.css",
    ]);
    assert.deepEqual(await archiveNames(result.perlLibraryVfsArchive), [
      "perl5/lib",
      "perl5/lib/Example.pm",
    ]);
    assert.deepEqual(result.omittedEmbeddedFiles, ["perl5/lib/Duplicate.pm"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package.json can override the default application directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "webdyne-config-test-"));
  try {
    await mkdir(join(root, "site/assets/icons"), { recursive: true });
    await writeFile(join(root, "site/home.psp"), "<html>home</html>\n");
    await writeFile(join(root, "site/assets/site.css"), "body {}\n");
    await writeFile(join(root, "site/assets/icons/webdyne.txt"), "nested asset\n");
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "custom-webdyne-app",
      private: true,
      webdyne: { appDirectory: "site", entry: "home.psp" },
    }, null, 2)}\n`);

    await cloudflareMain(["build"], root);
    assert.deepEqual(await archiveNames(join(root, ".webdyne/app-vfs.tar.gz")), [
      "app",
      "app/assets",
      "app/assets/icons",
      "app/assets/icons/webdyne.txt",
      "app/assets/site.css",
      "app/home.psp",
    ]);
    assert.match(await readFile(join(root, ".webdyne/worker.js"), "utf8"), /createCloudflareWorker/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declared npm extensions contribute Perl modules and static Worker imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "webdyne-extension-test-"));
  try {
    const extensionRoot = join(root, "node_modules/@webdyne/example-extension");
    await mkdir(join(root, "app"), { recursive: true });
    await mkdir(join(extensionRoot, "lib/Example"), { recursive: true });
    await writeFile(join(root, "app/app.psp"), "<html>extension</html>\n");
    await writeFile(join(extensionRoot, "lib/Example/Extension.pm"), "package Example::Extension; 1;\n");
    await writeFile(join(extensionRoot, "cloudflare.js"), "export function createExampleExtension() { return {}; }\n");
    await writeFile(join(extensionRoot, "webdyne-extension.json"), `${JSON.stringify({
      schemaVersion: 1,
      perlLibrary: "lib",
      providers: {
        cloudflare: { module: "./cloudflare", factory: "createExampleExtension" },
      },
    }, null, 2)}\n`);
    await writeFile(join(extensionRoot, "package.json"), `${JSON.stringify({
      name: "@webdyne/example-extension",
      version: "1.0.0",
      type: "module",
      exports: {
        "./cloudflare": "./cloudflare.js",
        "./webdyne-extension.json": "./webdyne-extension.json",
      },
    }, null, 2)}\n`);
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "extension-consumer",
      private: true,
      dependencies: { "@webdyne/example-extension": "1.0.0" },
      webdyne: {
        extensions: {
          "@webdyne/example-extension": { enabled: true },
        },
      },
    }, null, 2)}\n`);

    await cloudflareMain(["build"], root);
    assert.deepEqual(await archiveNames(join(root, ".webdyne/perl-lib-vfs.tar.gz")), [
      "perl5/lib",
      "perl5/lib/Example",
      "perl5/lib/Example/Extension.pm",
    ]);
    const generatedWorker = await readFile(join(root, ".webdyne/worker.js"), "utf8");
    assert.match(generatedWorker, /@webdyne\/example-extension\/cloudflare/);
    assert.match(generatedWorker, /createExampleExtension as webdyneExtensionFactory0/);
    assert.match(generatedWorker, /webdyneExtensionFactory0\(\{"enabled":true\}\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated Cloudflare configuration validates and emits D1 databases", async () => {
  const root = await mkdtemp(join(tmpdir(), "webdyne-d1-config-test-"));
  try {
    await mkdir(join(root, ".webdyne"), { recursive: true });
    const path = await generatedWranglerConfig(root, {
      packageJson: { name: "d1-consumer" },
      webdyne: {},
      cloudflare: {
        d1Databases: [{
          binding: "DB",
          databaseName: "webdyne-time",
          databaseId: "00000000-0000-0000-0000-000000000001",
        }],
      },
    }, { entry: "app.psp" }, join(root, ".webdyne"));
    const config = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(config.d1_databases, [{
      binding: "DB",
      database_name: "webdyne-time",
      database_id: "00000000-0000-0000-0000-000000000001",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host-native Perl libraries are rejected before VFS packaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "webdyne-native-library-test-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await mkdir(join(root, "local-lib/auto/Example"), { recursive: true });
    await writeFile(join(root, "app/app.psp"), "<html>ok</html>\n");
    await writeFile(join(root, "local-lib/auto/Example/Example.so"), "native host binary\n");
    await assert.rejects(
      buildApplicationArchives({
        projectRoot: root,
        appDirectory: "app",
        libraryDirectories: ["local-lib"],
        outputDirectory: join(root, ".webdyne"),
      }),
      /Native Perl artifacts cannot run in the WASM runtime/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the packaged bridge exposes the runtime primitives", async () => {
  const bridge = await import(new URL("../js/zeroperl.js", import.meta.url));
  assert.equal(typeof bridge.ZeroPerl, "function");
  assert.equal(typeof bridge.MemoryFileSystem, "function");
});
