import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, readdir } from "node:fs/promises";
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

async function checkedSource(root, requested) {
  const source = resolve(root, requested);
  if (!isInside(root, source)) throw new Error(`Source escapes the document root: ${requested}`);
  const resolvedSource = await realpath(source);
  const resolvedRoot = await realpath(root);
  if (!isInside(resolvedRoot, resolvedSource)) throw new Error(`Source symlink escapes the document root: ${requested}`);
  return { source, status: await lstat(source) };
}

async function assertPurePerlTree(directory) {
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, child.name);
    if (child.isDirectory()) await assertPurePerlTree(filename);
    else if (child.isSymbolicLink()) {
      throw new Error(`Perl library symlinks are not portable: ${filename}`);
    } else if (child.isFile() && nativeExtensions.has(extname(filename).toLowerCase())) {
      throw new Error(`Native Perl artifacts cannot run in the WASM runtime: ${filename}`);
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
    // remains nonzero after the WASI stat conversion used by WebDyne.
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

export async function buildApplicationArchives({
  documentRoot,
  include,
  library,
  outputDirectory,
}) {
  const root = resolve(documentRoot);
  const applicationSources = [];

  for (const requested of include) {
    const { source, status } = await checkedSource(root, requested);
    const normalized = relative(root, source).replaceAll("\\", "/");
    const target = normalized === "." || normalized === "" ? "htdocs" : `htdocs/${normalized}`;
    if (status.isSymbolicLink()) throw new Error(`Application symlinks are not portable: ${requested}`);
    if (status.isDirectory()) applicationSources.push({ type: "directory", source, target });
    else if (status.isFile()) applicationSources.push({ type: "file", source, target });
    else throw new Error(`Unsupported application source: ${requested}`);
  }

  const htdocsArchive = resolve(outputDirectory, "htdocs-vfs.tar.gz");
  const perlLibraryArchive = resolve(outputDirectory, "perl-lib-vfs.tar.gz");
  await writeArchive(applicationSources, htdocsArchive, applicationFilter);

  if (library) {
    const libraryRoot = resolve(library);
    await assertPurePerlTree(libraryRoot);
    await writeArchive(
      [{ type: "directory", source: libraryRoot, target: "local/lib/perl5" }],
      perlLibraryArchive,
      (name) => !name.replaceAll("\\", "/").split("/").includes(".meta")
        && extname(name).toLowerCase() !== ".pod",
    );
  } else {
    await writeArchive([], perlLibraryArchive);
  }

  return { htdocsArchive, perlLibraryArchive };
}
