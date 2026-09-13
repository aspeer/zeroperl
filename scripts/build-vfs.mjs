import { createWriteStream } from "node:fs";
import { lstat, mkdir, writeFile, realpath, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
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
 * are omitted when the release inventory can prove byte equality.
 */
export async function buildApplicationArchives({
  projectRoot,
  appDirectory,
  libraryDirectories = [],
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

  // Validate before writing even the application archive: a misconfigured
  // output inside a source tree must not mutate that tree on a failed build.
  const outputRoot = await canonicalOutput(outputDirectory);
  for (const source of [applicationRoot, ...libraries]) {
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
  try {
    if (libraries.length) stage = await stagePerlLibraries({
      libraries, outputDirectory, embeddedFiles, sourceInventory, minify, runtime,
    });
    await writeArchive(
      stage ? [{ type: "directory", source: stage.directory, target: "perl5" }] : [],
      perlLibraryVfsArchive,
    );
    const reportPath = resolve(outputDirectory, "perl-library-report.json");
    await writeFile(reportPath, `${JSON.stringify(stage?.report ?? {
      schema: 1, files: [], input_bytes: 0, output_bytes: 0, saved_bytes: 0,
    }, null, 2)}\n`);
    return {
      appVfsArchive, perlLibraryVfsArchive, reportPath,
      libraryReport: stage?.report,
      omittedEmbeddedFiles: stage?.omittedEmbeddedFiles ?? [],
    };
  } finally {
    await stage?.cleanup();
  }
}
