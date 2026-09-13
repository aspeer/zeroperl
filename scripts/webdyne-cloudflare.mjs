#!/usr/bin/env node

// Application CLI: package WebDyne sources and drive the bundled Wrangler.
// Runtime service bridges are supplied by WebDyne extension packages.

import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApplicationArchives } from "./build-vfs.mjs";
import { installCpanDependencies } from "./install-cpan.mjs";
import { defaultAssetsIgnore, readAssetsPolicy } from "./assets.mjs";
import { lifespanCallbackName } from "../js/runtime/config.js";
import {
  extensionConfiguration,
  extensionWorkerSource,
  resolveWebDyneExtensions,
} from "./extensions.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distributionPackage = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const distributionName = distributionPackage.name ?? "@webdyne/webdyne-zeroperl-5.44.0";
const distributionVersion = distributionPackage.version ?? "development";

// Check whether a path is accessible without making callers handle filesystem errors.
//
async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Print CLI commands and options, then exit with success or a usage error.
//
function usage(error) {
  if (error) console.error(error);
  console.error(`Usage:
  webdyne-cloudflare init [options]
  webdyne-cloudflare destroy [options] [-- wrangler-options]
  webdyne-cloudflare login|logout|whoami [-- wrangler-options]
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

// Validate an optional configuration object, treating an omitted value as empty.
//
function assertObject(value, description) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value;
}

function lifespanBindings(value) {
  const lifespan = assertObject(value, "package.json webdyne.lifespan");
  const bindings = {};
  for (const [phase, callback] of Object.entries(lifespan)) {
    if (!["startup", "shutdown"].includes(phase)) {
      throw new Error(`Unknown package.json webdyne.lifespan option: ${phase}`);
    }
    bindings[`WEBDYNE_${phase.toUpperCase()}`] = lifespanCallbackName(callback, `webdyne.lifespan.${phase}`);
  }
  return bindings;
}

// Check lexical containment, including the parent itself; symlinks are checked separately.
//
function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

// Resolve a non-empty path and reject traversal outside its allowed root.
//
function safeProjectPath(projectRoot, requested, description) {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new Error(`${description} must be a non-empty path`);
  }
  const path = resolve(projectRoot, requested);
  if (!isInside(projectRoot, path)) throw new Error(`${description} escapes the project root: ${requested}`);
  return path;
}

// Apply project defaults and parse CLI options, preserving arguments after -- for Wrangler.
//
function parseArguments(argv, defaults) {
  const command = argv.shift();
  if (!command || command === "--help" || command === "-h") usage();
  if (!["init", "build", "check", "dev", "deploy", "destroy"].includes(command)) usage(`Unknown command: ${command}`);

  const options = {
    command,
    appDirectory: defaults.appDirectory,
    entry: defaults.entry,
    libraries: [...defaults.libraries],
    output: defaults.output,
    wranglerConfig: defaults.wranglerConfig,
    wranglerArguments: [],
  };
  const names = new Map([
    ["--app-directory", "appDirectory"],
    ["--document-root", "appDirectory"],
    ["--entry", "entry"],
    ["--output", "output"],
    ["--wrangler-config", "wranglerConfig"],
  ]);
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
    const name = names.get(argument);
    if (!name) usage(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value) usage(`${argument} requires a value`);
    options[name] = value;
  }
  return options;
}

// Derive a Worker name from the unscoped npm package name, with a safe fallback.
//
function workerName(packageJson) {
  const source = packageJson.name || "webdyne-app";
  const unscoped = source.includes("/") ? source.split("/").at(-1) : source;
  const normalized = unscoped.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "webdyne-app").slice(0, 63);
}

// Load application metadata and normalize WebDyne settings into CLI defaults.
//
async function readProject(projectRoot) {
  const packagePath = resolve(projectRoot, "package.json");
  if (!(await exists(packagePath))) {
    throw new Error("package.json is required in the WebDyne application repository");
  }
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const webdyne = assertObject(packageJson.webdyne, "package.json webdyne");
  lifespanBindings(webdyne.lifespan);
  const cloudflare = assertObject(webdyne.cloudflare, "package.json webdyne.cloudflare");
  const extensions = extensionConfiguration(webdyne.extensions);
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
    extensions,
    defaults: {
      appDirectory: webdyne.appDirectory ?? "app",
      entry: webdyne.entry ?? "app.psp",
      libraries,
      output: webdyne.outputDirectory ?? ".webdyne",
      wranglerConfig: cloudflare.wranglerConfig,
    },
  };
}

// Add application defaults, npm commands and ignore files while preserving existing scripts.
//
async function initialize(projectRoot, project, options) {
  const appRoot = safeProjectPath(projectRoot, options.appDirectory, "WebDyne application directory");
  const output = safeProjectPath(projectRoot, options.output, "WebDyne output directory");
  safeProjectPath(appRoot, options.entry, "WebDyne entry page");
  if (options.wranglerConfig) safeProjectPath(projectRoot, options.wranglerConfig, "Wrangler configuration");
  if (isInside(appRoot, output)) throw new Error("Generated output must be outside the assets directory");
  await mkdir(appRoot, { recursive: true });
  if (!isInside(projectRoot, await realpath(appRoot))) throw new Error("Application symlink escapes the project root");
  await readAssetsPolicy(appRoot);
  const packageJson = project.packageJson;
  const scripts = assertObject(packageJson.scripts, "package.json scripts");
  for (const command of ["build", "check", "dev", "deploy", "destroy", "login", "logout", "whoami"]) {
    const value = `webdyne-cloudflare ${command}`;
    if (scripts[command] !== undefined && scripts[command] !== value) {
      console.log(`Preserved existing npm script: ${command}`);
    }
    scripts[command] ??= value;
  }
  packageJson.scripts = scripts;
  packageJson.webdyne = {
    ...project.webdyne,
    appDirectory: options.appDirectory,
    entry: options.entry,
    static: false,
    outputDirectory: options.output,
    ...(options.libraries.length ? { perlLibrary: [...new Set(options.libraries)] } : {}),
  };
  if (options.wranglerConfig) {
    packageJson.webdyne.cloudflare = { ...project.cloudflare, wranglerConfig: options.wranglerConfig };
  }
  const ignorePath = resolve(appRoot, ".assetsignore");
  if (!(await exists(ignorePath))) await writeFile(ignorePath, defaultAssetsIgnore, { flag: "wx" });
  const gitignorePath = resolve(projectRoot, ".gitignore");
  const previous = (await exists(gitignorePath)) ? await readFile(gitignorePath, "utf8") : "";
  const lines = previous.split(/\r?\n/);
  const outputPattern = `/${relative(projectRoot, output).replaceAll("\\", "/")}/`;
  const missing = ["/node_modules/", "/.wrangler/", outputPattern].filter((line) => !lines.includes(line));
  if (missing.length) {
    await writeFile(gitignorePath, `${previous}${previous && !previous.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  }
  await writeFile(resolve(projectRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Initialized ${options.appDirectory}/${options.entry}. Run npm run dev; npm run login; npm run whoami; npm run deploy.`);
  if (!(await exists(resolve(appRoot, options.entry)))) console.log(`Create ${options.appDirectory}/${options.entry} before building.`);
}

// Resolve Wrangler assets and their privacy policy, honoring an explicit --assets option.
//
async function applicationAssets(projectRoot, options) {
  const args = options.wranglerArguments;
  let requested = options.appDirectory;
  let explicit = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--assets" || args[index].startsWith("--assets=")) {
      requested = args[index] === "--assets" ? args[++index] : args[index].slice(9);
      if (!requested || requested.startsWith("--")) throw new Error("--assets requires a directory");
      explicit = true;
    }
  }
  const directory = safeProjectPath(projectRoot, requested, "Cloudflare assets directory");
  if (!isInside(projectRoot, await realpath(directory))) throw new Error("Assets symlink escapes the project root");
  const policy = await readAssetsPolicy(directory);
  if (policy && isInside(directory, resolve(projectRoot, options.output))) {
    throw new Error("Generated output must be outside the assets directory");
  }
  return { policy, arguments: policy && !explicit ? ["--assets", directory] : [] };
}

// Load the packaged file hashes used to omit byte-identical embedded Perl modules.
//
async function readEmbeddedFiles() {
  const inventory = resolve(packageRoot, "embedded-files.json");
  return (await exists(inventory)) ? JSON.parse(await readFile(inventory, "utf8")) : {};
}

// Package application and Perl libraries, then write the Worker entry with extension imports.
//
async function build(projectRoot, project, options, assets) {
  const outputDirectory = safeProjectPath(projectRoot, options.output, "WebDyne output directory");
  const appDirectory = relative(
    projectRoot,
    safeProjectPath(projectRoot, options.appDirectory, "WebDyne application directory"),
  );
  const entryPath = safeProjectPath(resolve(projectRoot, appDirectory), options.entry, "WebDyne entry page");
  if (!(await exists(entryPath))) throw new Error(`WebDyne entry page does not exist: ${options.entry}`);
  if (assets?.isPublic(entryPath)) {
    throw new Error(`The entry ${options.entry} would be public: add it to ${resolve(assets.directory, ".assetsignore")}`);
  }

  const libraries = [...options.libraries];
  const extensions = await resolveWebDyneExtensions(projectRoot, project.packageJson, project.extensions);
  libraries.push(...extensions.map(({ perlLibrary }) => relative(projectRoot, perlLibrary)));
  const installedCpanLibrary = await installCpanDependencies({ projectRoot, outputDirectory });
  if (installedCpanLibrary) libraries.push(relative(projectRoot, installedCpanLibrary));

  const archives = await buildApplicationArchives({
    projectRoot,
    appDirectory,
    libraryDirectories: libraries,
    outputDirectory,
    embeddedFiles: await readEmbeddedFiles(),
    assets,
  });

  const extensionSource = extensionWorkerSource(extensions);
  const entrySource = `import { createCloudflareWorker } from ${JSON.stringify(`${distributionName}/cloudflare`)};
import zeroperlModule from ${JSON.stringify(`${distributionName}/zeroperl.wasm`)};
import appVfsArchive from "./app-vfs.tar.gz";
import perlLibraryVfsArchive from "./perl-lib-vfs.tar.gz";
${extensionSource.imports}
${extensionSource.declaration}

export default createCloudflareWorker({
  zeroperlModule,
  appVfsArchive,
  perlLibraryVfsArchive,
  extensions: webdyneExtensions,
});
`;
  await writeFile(resolve(outputDirectory, "worker.js"), entrySource);
  if (archives.omittedEmbeddedFiles.length > 0) {
    console.log(`Omitted ${archives.omittedEmbeddedFiles.length} byte-identical files already embedded in ZeroPerl`);
  }
  console.log(
    `Built ${appDirectory}/${options.entry} for ${distributionName}@${distributionVersion} in ${options.output}`,
  );
  return { outputDirectory, appDirectory, extensions };
}

// Validate D1 deployment settings and translate them to Wrangler field names.
// This belongs to CLI configuration generation; D1 queries and Perl marshalling
// are implemented by the pm-WebDyne-Cloudflare runtime extension.
//
function cloudflareD1Databases(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("package.json webdyne.cloudflare.d1Databases must be an array");
  return value.map((database, index) => {
    const item = assertObject(database, `webdyne.cloudflare.d1Databases[${index}]`);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(item.binding ?? "")) {
      throw new TypeError(`Invalid D1 binding name at webdyne.cloudflare.d1Databases[${index}]`);
    }
    if (typeof item.databaseName !== "string" || item.databaseName.length === 0
      || typeof item.databaseId !== "string" || item.databaseId.length === 0) {
      throw new TypeError(`D1 database ${item.binding} requires databaseName and databaseId`);
    }
    return {
      binding: item.binding,
      database_name: item.databaseName,
      database_id: item.databaseId,
      ...(typeof item.previewDatabaseId === "string" && item.previewDatabaseId.length > 0
        ? { preview_database_id: item.previewDatabaseId }
        : {}),
    };
  });
}

// Validate KV deployment settings and translate them to Wrangler namespace bindings.
//
function cloudflareKVNamespaces(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("package.json webdyne.cloudflare.kvNamespaces must be an array");
  return value.map((namespace, index) => {
    const item = assertObject(namespace, `webdyne.cloudflare.kvNamespaces[${index}]`);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(item.binding ?? "")) {
      throw new TypeError(`Invalid KV binding name at webdyne.cloudflare.kvNamespaces[${index}]`);
    }
    if (item.namespaceId !== undefined
      && (typeof item.namespaceId !== "string" || item.namespaceId.length === 0)) {
      throw new TypeError(`KV namespace ${item.binding} namespaceId must be a non-empty string`);
    }
    if (item.previewNamespaceId !== undefined
      && (typeof item.previewNamespaceId !== "string" || item.previewNamespaceId.length === 0)) {
      throw new TypeError(`KV namespace ${item.binding} previewNamespaceId must be a non-empty string`);
    }
    if (item.remote !== undefined && typeof item.remote !== "boolean") {
      throw new TypeError(`KV namespace ${item.binding} remote must be boolean`);
    }
    return {
      binding: item.binding,
      ...(item.namespaceId === undefined ? {} : { id: item.namespaceId }),
      ...(item.previewNamespaceId === undefined ? {} : { preview_id: item.previewNamespaceId }),
      ...(item.remote === undefined ? {} : { remote: item.remote }),
    };
  });
}

// Bind individual account secrets; values never belong in deployment configuration.
//
function cloudflareSecretsStoreSecrets(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("webdyne.cloudflare.secretsStoreSecrets must be an array");
  const bindings = new Set();
  return value.map((entry, index) => {
    const item = assertObject(entry, `webdyne.cloudflare.secretsStoreSecrets[${index}]`);
    if (Object.keys(item).some(key => !["binding", "storeId", "secretName"].includes(key))
      || !/^[A-Z_][A-Z0-9_]*$/.test(item.binding ?? "")
      || typeof item.storeId !== "string" || !/^[a-f0-9]{32}$/i.test(item.storeId)
      || typeof item.secretName !== "string" || !item.secretName.length || /\s/.test(item.secretName)
      || bindings.has(item.binding)) {
      throw new TypeError(`Invalid Secrets Store binding configuration at index ${index}`);
    }
    bindings.add(item.binding);
    return { binding: item.binding, store_id: item.storeId, secret_name: item.secretName };
  });
}

// Validate R2 deployment settings and translate them to Wrangler bucket bindings.
//
function cloudflareR2Buckets(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("package.json webdyne.cloudflare.r2Buckets must be an array");
  return value.map((bucket, index) => {
    const item = assertObject(bucket, `webdyne.cloudflare.r2Buckets[${index}]`);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(item.binding ?? "")) {
      throw new TypeError(`Invalid R2 binding name at webdyne.cloudflare.r2Buckets[${index}]`);
    }
    for (const name of ["bucketName", "previewBucketName", "jurisdiction"]) {
      if (item[name] !== undefined && (typeof item[name] !== "string" || item[name].length === 0)) {
        throw new TypeError(`R2 bucket ${item.binding} ${name} must be a non-empty string`);
      }
    }
    if (item.remote !== undefined && typeof item.remote !== "boolean") {
      throw new TypeError(`R2 bucket ${item.binding} remote must be boolean`);
    }
    return {
      binding: item.binding,
      ...(item.bucketName === undefined ? {} : { bucket_name: item.bucketName }),
      ...(item.previewBucketName === undefined ? {} : { preview_bucket_name: item.previewBucketName }),
      ...(item.jurisdiction === undefined ? {} : { jurisdiction: item.jurisdiction }),
      ...(item.remote === undefined ? {} : { remote: item.remote }),
    };
  });
}

// Hyperdrive credentials belong in bindings or private development environment.
function cloudflareHyperdrive(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("package.json webdyne.cloudflare.hyperdrive must be an array");
  const seen = new Set();
  return value.map((entry, index) => {
    const item = assertObject(entry, `webdyne.cloudflare.hyperdrive[${index}]`);
    if (typeof item.binding !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(item.binding) || seen.has(item.binding)) {
      throw new TypeError(`Invalid or duplicate Hyperdrive binding at index ${index}`);
    }
    if (typeof item.id !== "string" || !/^[a-f0-9]{32}$/i.test(item.id)) throw new TypeError(`Hyperdrive ${item.binding} requires a 32-character configuration id`);
    if (Object.keys(item).some(key => !["binding", "id"].includes(key))) throw new TypeError("Hyperdrive accepts binding and id only; put local credentials in WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>");
    seen.add(item.binding);
    return { binding: item.binding, id: item.id };
  });
}

// Use an explicit or project-root Wrangler config, otherwise write the generated defaults.
// Binding translation applies only to generated configuration; supplied files are left intact.
//
export async function generatedWranglerConfig(projectRoot, project, options, outputDirectory, extensions = []) {
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
    compatibility_flags: [...new Set(["enable_request_signal", ...extensions.flatMap(extension => extension.compatibilityFlags ?? []),
      ...(project.cloudflare.hyperdrive?.length ? ["nodejs_compat"] : [])])],
    workers_dev: project.cloudflare.workersDev ?? true,
    observability: { enabled: true, traces: { enabled: true } },
    vars: {
      WEBDYNE_ROOT: "/app",
      WEBDYNE_INDEX: options.entry,
      WEBDYNE_STATIC: project.webdyne.static === false ? "0" : "1",
      ...lifespanBindings(project.webdyne.lifespan),
    },
    rules: [
      { type: "Text", globs: ["**/*.pl", "**/*.pm"], fallthrough: false },
      { type: "Data", globs: ["**/*.tar.gz"], fallthrough: false },
    ],
    ...(project.cloudflare.secretsStoreSecrets === undefined
      ? {}
      : { secrets_store_secrets: cloudflareSecretsStoreSecrets(project.cloudflare.secretsStoreSecrets) }),
    ...(project.cloudflare.hyperdrive === undefined ? {} : { hyperdrive: cloudflareHyperdrive(project.cloudflare.hyperdrive) }),
    ...(project.cloudflare.d1Databases === undefined
      ? {}
      : { d1_databases: cloudflareD1Databases(project.cloudflare.d1Databases) }),
    ...(project.cloudflare.kvNamespaces === undefined
      ? {}
      : { kv_namespaces: cloudflareKVNamespaces(project.cloudflare.kvNamespaces) }),
    ...(project.cloudflare.r2Buckets === undefined
      ? {}
      : { r2_buckets: cloudflareR2Buckets(project.cloudflare.r2Buckets) }),
  };
  await writeFile(generatedConfig, `${JSON.stringify(config, null, 2)}\n`);
  return generatedConfig;
}

// Run the bundled Wrangler with inherited terminal streams and report startup or exit failures.
//
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

// Require an interactive terminal and explicit Yes before allowing Worker deletion.
//
export async function confirmDestroy(message, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("destroy requires an interactive terminal; no Worker was deleted");
  }
  const prompt = createInterface({ input, output });
  try {
    return (await prompt.question(`${message}\nAre you sure [Yes/No] (default No)? `)).trim().toLowerCase() === "yes";
  } finally {
    prompt.close();
  }
}

// Dispatch authentication, initialization, deletion and build/deploy commands.
// Injectable Wrangler and confirmation functions let tests exercise commands without deployment.
//
export async function main(
  argv = process.argv.slice(2),
  projectRoot = process.cwd(),
  wrangler = runWrangler,
  confirm = confirmDestroy,
) {
  // Canonicalize once so package-manager symlinks and macOS' /var -> /private/var
  // alias cannot make a resolved extension appear to escape the project root.
  const root = await realpath(resolve(projectRoot));
  if (!argv.length || ["--help", "-h"].includes(argv[0])) return usage();
  if (["login", "logout", "whoami"].includes(argv[0])) {
    const args = argv.slice(1);
    if (args[0] === "--") args.shift();
    return wrangler([argv[0], ...args], root);
  }
  const project = await readProject(root);
  const options = parseArguments([...argv], project.defaults);
  if (options.command === "init") return initialize(root, project, options);
  if (options.command === "destroy") {
    // Never use --force to suppress Wrangler's prompt: it also bypasses checks
    // for other Workers depending on this one.
    if (options.wranglerArguments.some((arg) => /^--(force|yes)(=|$)|^-y$/.test(arg))) {
      throw new Error("destroy does not allow confirmation bypass flags");
    }
    const output = safeProjectPath(root, options.output, "WebDyne output directory");
    await mkdir(output, { recursive: true });
    const config = await generatedWranglerConfig(root, project, options, output);
    const args = ["delete", "--config", config, ...options.wranglerArguments];
    if (!await confirm(`Delete the Cloudflare Worker selected by:\nwrangler ${args.map((arg) => JSON.stringify(arg)).join(" ")}`)) {
      console.log("Cancelled; no Worker was deleted.");
      return;
    }
    return wrangler(args, root);
  }
  const assets = await applicationAssets(root, options);
  const built = await build(root, project, options, assets.policy);
  if (options.command === "build") return;

  const config = await generatedWranglerConfig(root, project, options, built.outputDirectory, built.extensions);
  const configArguments = ["--config", config, ...assets.arguments];
  const wranglerArguments = [...configArguments, ...options.wranglerArguments];
  if (options.command === "dev") {
    await wrangler(["dev", ...wranglerArguments], root);
    return;
  }

  // Both check and deploy validate the bundle; only deploy then uploads it.
  await wrangler([
    "deploy", "--dry-run", "--outdir", resolve(built.outputDirectory, "dist"),
    ...wranglerArguments,
  ], root);
  if (options.command === "deploy") await wrangler(["deploy", ...wranglerArguments], root);
}

// Run only when invoked as the CLI, including through an npm executable symlink.
const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => undefined) : undefined;
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
