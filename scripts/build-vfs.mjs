import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile, realpath, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { packTar } from "modern-tar/fs";

import { stagePerlLibraries } from "./stage-perl-libraries.mjs";
const excludedApplicationComponents = new Set([
  ".dev.vars",
  ".git",
  ".webdyne",
  "node_modules",
]);

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function checkedDirectory(root, requested, description) {
  const source = resolve(root, requested);
  if (!isInside(root, source)) throw new Error(`${description} escapes the project root: ${requested}`);
  const resolvedSource = await realpath(source);
  const resolvedRoot = await realpath(root);
  if (!isInside(resolvedRoot, resolvedSource)) throw new Error(`${description} symlink escapes the project root: ${requested}`);
  const status = await lstat(source);
  if (!status.isDirectory()) throw new Error(`${description} is not a directory: ${requested}`);
  return resolvedSource;
}

// Resolve existing ancestors as well as the not-yet-created output suffix.
// This detects a symlinked output parent before any archive can touch sources.
async function canonicalOutput(directory) {
  let ancestor = resolve(directory);
  const suffix = [];
  while (true) {
    try { return join(await realpath(ancestor), ...suffix); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

async function assertApplicationTree(directory) {
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, child.name);
    if (child.isDirectory()) await assertApplicationTree(filename);
    else if (child.isSymbolicLink()) {
      throw new Error(`Application symlinks are not portable: ${filename}`);
    } else if (!child.isFile()) {
      throw new Error(`Unsupported application filesystem entry: ${filename}`);
    }
  }
}

// Explicit libraries bypass Perl entirely. Inspect every entry without filtering
// or flattening names; native objects and links are rejected rather than dropped.
// Keep empty directories too. Later explicit roots win file collisions.
async function inspectVerbatimLibrary(directory, files, directories, entries) {
  async function visit(current) {
    for (const child of await readdir(current, { withFileTypes: true })) {
      const source = join(current, child.name);
      const path = relative(directory, source).split(sep).join("/");
      if (child.isDirectory()) {
        directories.add(path);
        await visit(source);
      } else if (child.isSymbolicLink()) {
        throw new Error(`Perl library symlinks are not portable: ${source}`);
      } else if (!child.isFile()) {
        throw new Error(`Unsupported Perl library filesystem entry: ${source}`);
      } else {
        const content = await readFile(source);
        if ([".a", ".bundle", ".dll", ".dylib", ".o", ".so"].includes(extname(path).toLowerCase())
            || (extname(path).toLowerCase() === ".bs" && content.length)) {
          throw new Error(`Native Perl artifacts cannot run in the WASM runtime: ${source}`);
        }
        const file = {source, path, bytes: content.length, hash: createHash("sha256").update(content).digest("hex")};
        entries.push(file);
        files.set(path, file);
      }
    }
  }
  await visit(directory);
}

function deterministicHeader(header) {
  return {
    ...header,
    uid: 0,
    gid: 0,
    uname: "",
    gname: "",
    // File.lastModified is expressed in milliseconds. One whole epoch second
    // remains nonzero after conversion by the ZeroPerl WASI filesystem.
    mtime: new Date(1000),
  };
}

async function writeArchive(sources, destination, filter = () => true) {
  await mkdir(dirname(destination), { recursive: true });
  await pipeline(
    packTar(sources, {
      dereference: false,
      // Directory workers append child jobs as they finish. Serial traversal
      // prevents filesystem timing from changing archive entry order.
      concurrency: 1,
      filter,
      map: deterministicHeader,
    }),
    createGzip({ level: 9, mtime: 0 }),
    createWriteStream(destination),
  );
}

function applicationFilter(name) {
  const components = name.replaceAll("\\", "/").split("/");
  return !components.some((component) => excludedApplicationComponents.has(component));
}

/**
 * Package a complete application tree and optional Pure-Perl libraries.
 * Repository `app/` becomes VFS `/app`; every library root becomes
 * `/perl5/lib`. Identical files already present in the immutable Wasm prefix
 * are omitted from managed libraries when the inventory proves byte equality.
 * verbatimLibraryDirectories bypass Perl and override managed files unchanged.
 */
export async function buildApplicationArchives({
  projectRoot,
  appDirectory,
  libraryDirectories = [],
  verbatimLibraryDirectories = [],
  outputDirectory,
  embeddedFiles = {},
  assets,
  sourceInventory = {},
  minify = false,
  runtime,
}) {
  const root = resolve(projectRoot);
  const applicationRoot = await checkedDirectory(root, appDirectory, "WebDyne application directory");
  await assertApplicationTree(applicationRoot);
  const libraries = [];
  for (const requested of libraryDirectories) {
    const library = await checkedDirectory(root, requested, "Perl library directory");
    libraries.push(library);
  }

  const verbatimLibraries = [];
  const verbatimFiles = new Map();
  const verbatimEntries = [];
  const verbatimDirectories = new Set();
  for (const requested of verbatimLibraryDirectories) {
    const library = await checkedDirectory(root, requested, "Perl library directory");
    verbatimLibraries.push(library);
    await inspectVerbatimLibrary(library, verbatimFiles, verbatimDirectories, verbatimEntries);
  }

  // A supplied override must not allow a managed host XS object to be discarded
  // on the assumption that its embedded companion will execute unchanged.
  const stagedEmbeddedFiles = {...embeddedFiles};
  for (const [path, file] of verbatimFiles) {
    if (file.hash !== embeddedFiles[path] && file.hash !== sourceInventory.sourceFiles?.[path]) {
      delete stagedEmbeddedFiles[path];
    }
  }

  // Validate before writing even the application archive: a misconfigured
  // output inside a source tree must not mutate that tree on a failed build.
  const outputRoot = await canonicalOutput(outputDirectory);
  for (const source of [applicationRoot, ...libraries, ...verbatimLibraries]) {
    if (isInside(source, outputRoot)) throw new Error("Generated output must be outside Perl libraries and application sources");
  }

  const appVfsArchive = resolve(outputDirectory, "app-vfs.tar.gz");
  const perlLibraryVfsArchive = resolve(outputDirectory, "perl-lib-vfs.tar.gz");
  await writeArchive(
    [{ type: "directory", source: applicationRoot, target: "app" }],
    appVfsArchive,
    (name, stat) => applicationFilter(name)
      && (stat.isDirectory() || !assets?.isPublic(name)),
  );

  // Empty-library applications retain the Node-only build path. The stage is
  // otherwise disposable; its report is published only after archive success.
  let stage;
  let temporary;
  try {
    if (libraries.length) stage = await stagePerlLibraries({
      libraries, outputDirectory, embeddedFiles: stagedEmbeddedFiles, sourceInventory, minify, runtime,
    });
    let payload = stage?.directory;
    const report = stage?.report ?? {schema: 1, files: [], input_bytes: 0, output_bytes: 0, saved_bytes: 0};
    if (verbatimLibraries.length) {
      if (!payload) {
        temporary = await mkdtemp(join(outputRoot, ".verbatim-stage-"));
        payload = temporary;
      }
      await mkdir(join(payload, "lib"), {recursive: true});
      for (const path of verbatimDirectories) await mkdir(join(payload, "lib", path), {recursive: true});
      for (const [path, file] of verbatimFiles) {
        const destination = join(payload, "lib", path);
        // Count replacement bytes once, and make the report agree with the
        // final payload. File/directory conflicts fail rather than deleting trees.
        try { report.output_bytes -= (await stat(destination)).size; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await mkdir(dirname(destination), {recursive: true});
        await copyFile(file.source, destination);
        for (const entry of report.files) {
          if (entry.path === path && entry.action === "included") {
            entry.action = "omitted";
            entry.reason = "superseded by explicit library";
            delete entry.output_bytes;
            delete entry.output_sha256;
          }
        }
        report.output_bytes += file.bytes;
      }
      for (const file of verbatimEntries) {
        const included = verbatimFiles.get(file.path) === file;
        report.files.push({source: file.source, path: file.path, source_bytes: file.bytes, source_sha256: file.hash,
          action: included ? "included" : "omitted",
          reason: included ? "explicit library retained verbatim" : "superseded by later explicit library",
          ...(included ? {output_bytes: file.bytes, output_sha256: file.hash} : {})});
        report.input_bytes += file.bytes;
      }
      report.saved_bytes = report.input_bytes - report.output_bytes;
    }
    await writeArchive(payload ? [{type: "directory", source: payload, target: "perl5"}] : [], perlLibraryVfsArchive);
    const reportPath = resolve(outputDirectory, "perl-library-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return {
      appVfsArchive, perlLibraryVfsArchive, reportPath,
      libraryReport: stage || verbatimLibraries.length ? report : undefined,
      omittedEmbeddedFiles: (stage?.omittedEmbeddedFiles ?? []).filter(path => !verbatimFiles.has(path.slice("perl5/lib/".length))),
    };
  } finally {
    await stage?.cleanup();
    if (temporary) await rm(temporary, {recursive: true, force: true});
  }
}
