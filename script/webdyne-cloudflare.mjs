#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApplicationArchives } from "./build-vfs.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));

function usage(error) {
  if (error) console.error(error);
  console.error(`Usage:
  webdyne-cloudflare build [options]
  webdyne-cloudflare check [options] [-- wrangler-options]
  webdyne-cloudflare dev [options] [-- wrangler-options]
  webdyne-cloudflare deploy [options] [-- wrangler-options]

Options:
  --document-root DIR    Source root for application files (default: .)
  --entry FILE           Default PSP page (default: app.psp)
  --include PATH         File or directory below document root; repeatable
  --library DIR          Optional Pure-Perl application library
  --output DIR           Generated output directory (default: .webdyne)
  --wrangler-config FILE Wrangler configuration (default: wrangler.jsonc)`);
  process.exit(error ? 1 : 0);
}

function parseArguments(argv) {
  const command = argv.shift();
  if (!command || command === "--help" || command === "-h") usage();
  if (!["build", "check", "dev", "deploy"].includes(command)) usage(`Unknown command: ${command}`);

  const options = {
    command,
    documentRoot: ".",
    entry: "app.psp",
    include: [],
    output: ".webdyne",
    wranglerConfig: "wrangler.jsonc",
    wranglerArguments: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      options.wranglerArguments = argv.slice(index + 1);
      break;
    }
    const names = new Map([
      ["--document-root", "documentRoot"],
      ["--entry", "entry"],
      ["--library", "library"],
      ["--output", "output"],
      ["--wrangler-config", "wranglerConfig"],
    ]);
    if (argument === "--include") {
      const value = argv[++index];
      if (!value) usage("--include requires a path");
      options.include.push(value);
      continue;
    }
    const name = names.get(argument);
    if (!name) usage(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value) usage(`${argument} requires a value`);
    options[name] = value;
  }
  if (options.include.length === 0) options.include.push(options.entry);
  const entryPath = resolve(options.documentRoot, options.entry);
  const entryIncluded = options.include.some((included) => {
    const path = relative(resolve(options.documentRoot, included), entryPath);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
  });
  if (!entryIncluded) {
    throw new Error(`The entry page ${options.entry} is not included in the application archive`);
  }
  return options;
}

async function build(options) {
  const outputDirectory = resolve(options.output);
  await buildApplicationArchives({
    documentRoot: resolve(options.documentRoot),
    include: options.include,
    library: options.library ? resolve(options.library) : undefined,
    outputDirectory,
  });

  const entrySource = `import { createWebDyneWorker } from ${JSON.stringify(`${packageJson.name}/worker`)};
import zeroperlModule from ${JSON.stringify(`${packageJson.name}/zeroperl.wasm`)};
import htdocsVfsArchive from "./htdocs-vfs.tar.gz";
import perlLibraryVfsArchive from "./perl-lib-vfs.tar.gz";

export default createWebDyneWorker({
  zeroperlModule,
  htdocsVfsArchive,
  perlLibraryVfsArchive,
});
`;
  await writeFile(resolve(outputDirectory, "worker.js"), entrySource);
  console.log(`Built ${options.entry} for ${packageJson.name}@${packageJson.version} in ${outputDirectory}`);
}

function runWrangler(arguments_) {
  return new Promise((resolvePromise, reject) => {
    const executable = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
    const child = spawn(executable, arguments_, { stdio: "inherit" });
    child.once("error", (error) => reject(new Error(`Unable to start local Wrangler: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Wrangler terminated by ${signal}`));
      else if (code === 0) resolvePromise();
      else reject(new Error(`Wrangler exited with status ${code}`));
    });
  });
}

const options = parseArguments(process.argv.slice(2));
await build(options);

const configArguments = ["--config", options.wranglerConfig];
if (options.command === "check") {
  await runWrangler(["deploy", "--dry-run", "--outdir", resolve(options.output, "dist"), ...configArguments, ...options.wranglerArguments]);
} else if (options.command === "dev") {
  await runWrangler(["dev", ...configArguments, ...options.wranglerArguments]);
} else if (options.command === "deploy") {
  await runWrangler(["deploy", "--dry-run", "--outdir", resolve(options.output, "dist"), ...configArguments, ...options.wranglerArguments]);
  await runWrangler(["deploy", ...configArguments, ...options.wranglerArguments]);
}
