import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { packTar } from "modern-tar/fs";

const nativeExtensions = new Set([".a", ".bundle", ".dll", ".dylib", ".o", ".so"]);
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
  return source;
}

async function assertPurePerlTree(directory) {
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, child.name);
    if (child.isDirectory()) await assertPurePerlTree(filename);
    else if (child.isSymbolicLink()) {
      throw new Error(`Perl library symlinks are not portable: ${filename}`);
    } else if (child.isFile() && nativeExtensions.has(extname(filename).toLowerCase())) {
      throw new Error(`Native Perl artifacts cannot run in the WASM runtime: ${filename}`);
    } else if (!child.isFile()) {
      throw new Error(`Unsupported Perl library filesystem entry: ${filename}`);
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

function perlLibraryFilter(duplicates) {
  return (name) => {
    const normalized = name.replaceAll("\\", "/");
    const components = normalized.split("/");
    const isEmbeddedDuplicate = [...duplicates].some(
      (modulePath) => normalized === modulePath || normalized.endsWith(`/${modulePath}`),
    );
    return !components.includes(".meta")
      && !components.includes(".packlist")
      && extname(normalized).toLowerCase() !== ".pod"
      && !isEmbeddedDuplicate;
  };
}

async function collectIdenticalEmbeddedFiles(libraryDirectories, embeddedFiles) {
  const duplicates = new Set();
  if (!embeddedFiles || Object.keys(embeddedFiles).length === 0) return duplicates;

  async function visit(root, directory) {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, child.name);
      if (child.isDirectory()) {
        await visit(root, filename);
      } else if (child.isFile()) {
        const modulePath = relative(root, filename).replaceAll("\\", "/");
        const embeddedHash = embeddedFiles[modulePath];
        if (!embeddedHash) continue;
        const installedHash = createHash("sha256").update(await readFile(filename)).digest("hex");
        if (installedHash === embeddedHash) duplicates.add(modulePath);
      }
    }
  }

  for (const directory of libraryDirectories) await visit(directory, directory);
  return duplicates;
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
}) {
  const root = resolve(projectRoot);
  const applicationRoot = await checkedDirectory(root, appDirectory, "WebDyne application directory");
  await assertApplicationTree(applicationRoot);
  const libraries = [];
  for (const requested of libraryDirectories) {
    const library = await checkedDirectory(root, requested, "Perl library directory");
    await assertPurePerlTree(library);
    libraries.push(library);
  }

  const appVfsArchive = resolve(outputDirectory, "app-vfs.tar.gz");
  const perlLibraryVfsArchive = resolve(outputDirectory, "perl-lib-vfs.tar.gz");
  await writeArchive(
    [{ type: "directory", source: applicationRoot, target: "app" }],
    appVfsArchive,
    applicationFilter,
  );

  const duplicates = await collectIdenticalEmbeddedFiles(libraries, embeddedFiles);
  await writeArchive(
    libraries.map((source) => ({ type: "directory", source, target: "perl5/lib" })),
    perlLibraryVfsArchive,
    perlLibraryFilter(duplicates),
  );

  return {
    appVfsArchive,
    perlLibraryVfsArchive,
    omittedEmbeddedFiles: [...duplicates].sort().map((path) => `perl5/lib/${path}`),
  };
}
