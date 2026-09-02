#!/usr/bin/env node

import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApplicationArchives } from "./build-vfs.mjs";
import { installCpanDependencies } from "./install-cpan.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distributionPackage = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const distributionName = distributionPackage.name ?? "@webdyne/zeroperl-webdyne-5.44.0";
const distributionVersion = distributionPackage.version ?? "development";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function usage(error) {
  if (error) console.error(error);
  console.error(`Usage:
  webdyne-cloudflare build [options]
  webdyne-cloudflare check [options] [-- wrangler-options]
  webdyne-cloudflare dev [options] [-- wrangler-options]
  webdyne-cloudflare deploy [options] [-- wrangler-options]

Options:
  --app-directory DIR    Application tree (default: package.json webdyne.appDirectory or app)
  --document-root DIR    Backward-compatible alias for --app-directory
  --entry FILE           Default PSP page below the application tree (default: app.psp)
  --library DIR          Optional Pure-Perl library below the project root; repeatable
  --output DIR           Generated output directory (default: .webdyne)
  --wrangler-config FILE Explicit Wrangler configuration; otherwise root config or generated default`);
  process.exit(error ? 1 : 0);
}

function assertObject(value, description) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value;
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safeProjectPath(projectRoot, requested, description) {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new Error(`${description} must be a non-empty path`);
  }
  const path = resolve(projectRoot, requested);
  if (!isInside(projectRoot, path)) throw new Error(`${description} escapes the project root: ${requested}`);
  return path;
}

function parseArguments(argv, defaults) {
  const command = argv.shift();
  if (!command || command === "--help" || command === "-h") usage();
  if (!["build", "check", "dev", "deploy"].includes(command)) usage(`Unknown command: ${command}`);

  const options = {
    command,
    appDirectory: defaults.appDirectory,
    entry: defaults.entry,
    libraries: [...defaults.libraries],
    output: defaults.output,
    wranglerConfig: undefined,
    wranglerArguments: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      options.wranglerArguments = argv.slice(index + 1);
      break;
    }
    if (argument === "--library") {
      const value = argv[++index];
      if (!value) usage("--library requires a path");
      options.libraries.push(value);
      continue;
    }
    const names = new Map([
      ["--app-directory", "appDirectory"],
      ["--document-root", "appDirectory"],
      ["--entry", "entry"],
      ["--output", "output"],
      ["--wrangler-config", "wranglerConfig"],
    ]);
    const name = names.get(argument);
    if (!name) usage(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value) usage(`${argument} requires a value`);
    options[name] = value;
  }
  return options;
}

function workerName(packageJson) {
  const source = packageJson.name || "webdyne-app";
  const unscoped = source.includes("/") ? source.split("/").at(-1) : source;
  const normalized = unscoped.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "webdyne-app").slice(0, 63);
}

async function readProject(projectRoot) {
  const packagePath = resolve(projectRoot, "package.json");
  if (!(await exists(packagePath))) {
    throw new Error("package.json is required in the WebDyne application repository");
  }
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const webdyne = assertObject(packageJson.webdyne, "package.json webdyne");
  const cloudflare = assertObject(webdyne.cloudflare, "package.json webdyne.cloudflare");
  const libraries = webdyne.perlLibrary === undefined
    ? []
    : Array.isArray(webdyne.perlLibrary) ? webdyne.perlLibrary : [webdyne.perlLibrary];
  if (!libraries.every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("package.json webdyne.perlLibrary must be a path or array of paths");
  }
  return {
    packageJson,
    webdyne,
    cloudflare,
    defaults: {
      appDirectory: webdyne.appDirectory ?? "app",
      entry: webdyne.entry ?? "app.psp",
      libraries,
      output: webdyne.outputDirectory ?? ".webdyne",
    },
  };
}

async function readEmbeddedFiles() {
  const inventory = resolve(packageRoot, "embedded-files.json");
  return (await exists(inventory)) ? JSON.parse(await readFile(inventory, "utf8")) : {};
}

async function build(projectRoot, project, options) {
  const outputDirectory = safeProjectPath(projectRoot, options.output, "WebDyne output directory");
  const appDirectory = relative(
    projectRoot,
    safeProjectPath(projectRoot, options.appDirectory, "WebDyne application directory"),
  );
  const entryPath = safeProjectPath(resolve(projectRoot, appDirectory), options.entry, "WebDyne entry page");
  if (!(await exists(entryPath))) throw new Error(`WebDyne entry page does not exist: ${options.entry}`);

  const libraries = [...options.libraries];
  const installedCpanLibrary = await installCpanDependencies({ projectRoot, outputDirectory });
  if (installedCpanLibrary) libraries.push(relative(projectRoot, installedCpanLibrary));

  const archives = await buildApplicationArchives({
    projectRoot,
    appDirectory,
    libraryDirectories: libraries,
    outputDirectory,
    embeddedFiles: await readEmbeddedFiles(),
  });

  const entrySource = `import { createCloudflareWorker } from ${JSON.stringify(`${distributionName}/cloudflare`)};
import zeroperlModule from ${JSON.stringify(`${distributionName}/zeroperl.wasm`)};
import appVfsArchive from "./app-vfs.tar.gz";
import perlLibraryVfsArchive from "./perl-lib-vfs.tar.gz";

export default createCloudflareWorker({
  zeroperlModule,
  appVfsArchive,
  perlLibraryVfsArchive,
});
`;
  await writeFile(resolve(outputDirectory, "worker.js"), entrySource);
  if (archives.omittedEmbeddedFiles.length > 0) {
    console.log(`Omitted ${archives.omittedEmbeddedFiles.length} byte-identical files already embedded in ZeroPerl`);
  }
  console.log(
    `Built ${appDirectory}/${options.entry} for ${distributionName}@${distributionVersion} in ${options.output}`,
  );
  return { outputDirectory, appDirectory };
}

async function generatedWranglerConfig(projectRoot, project, options, outputDirectory) {
  if (options.wranglerConfig) {
    const explicit = safeProjectPath(projectRoot, options.wranglerConfig, "Wrangler configuration");
    if (!(await exists(explicit))) throw new Error(`Wrangler configuration does not exist: ${options.wranglerConfig}`);
    return explicit;
  }
  const rootConfig = resolve(projectRoot, "wrangler.jsonc");
  if (await exists(rootConfig)) return rootConfig;

  const generatedConfig = resolve(outputDirectory, "wrangler.jsonc");
  const config = {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: project.cloudflare.name ?? workerName(project.packageJson),
    main: "worker.js",
    compatibility_date: project.cloudflare.compatibilityDate ?? "2026-08-27",
    workers_dev: project.cloudflare.workersDev ?? true,
    vars: {
      WEBDYNE_ROOT: "/app",
      WEBDYNE_INDEX: options.entry,
      WEBDYNE_STATIC: project.webdyne.static === false ? "0" : "1",
    },
    rules: [
      { type: "Text", globs: ["**/*.pl", "**/*.pm"], fallthrough: false },
      { type: "Data", globs: ["**/*.tar.gz"], fallthrough: false },
    ],
  };
  await writeFile(generatedConfig, `${JSON.stringify(config, null, 2)}\n`);
  return generatedConfig;
}

function runWrangler(arguments_, projectRoot) {
  return new Promise((resolvePromise, reject) => {
    let wranglerCli;
    try {
      wranglerCli = fileURLToPath(import.meta.resolve("wrangler"));
    } catch (error) {
      reject(new Error(`Unable to resolve the bundled Wrangler dependency: ${error.message}`));
      return;
    }
    // Execute Wrangler's JavaScript entrypoint directly. Depending on npm's
    // PATH mutation makes direct `npx webdyne-cloudflare` calls work
    // differently from package.json scripts when dependencies are nested.
    const child = spawn(process.execPath, [wranglerCli, ...arguments_], { cwd: projectRoot, stdio: "inherit" });
    child.once("error", (error) => reject(new Error(`Unable to start bundled Wrangler: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Wrangler terminated by ${signal}`));
      else if (code === 0) resolvePromise();
      else reject(new Error(`Wrangler exited with status ${code}`));
    });
  });
}

export async function main(argv = process.argv.slice(2), projectRoot = process.cwd()) {
  const root = resolve(projectRoot);
  const project = await readProject(root);
  const options = parseArguments([...argv], project.defaults);
  const built = await build(root, project, options);
  if (options.command === "build") return;

  const config = await generatedWranglerConfig(root, project, options, built.outputDirectory);
  const configArguments = ["--config", config];
  if (options.command === "check") {
    await runWrangler([
      "deploy", "--dry-run", "--outdir", resolve(built.outputDirectory, "dist"),
      ...configArguments, ...options.wranglerArguments,
    ], root);
  } else if (options.command === "dev") {
    await runWrangler(["dev", ...configArguments, ...options.wranglerArguments], root);
  } else if (options.command === "deploy") {
    await runWrangler([
      "deploy", "--dry-run", "--outdir", resolve(built.outputDirectory, "dist"),
      ...configArguments, ...options.wranglerArguments,
    ], root);
    await runWrangler(["deploy", ...configArguments, ...options.wranglerArguments], root);
  }
}

const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => undefined) : undefined;
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
