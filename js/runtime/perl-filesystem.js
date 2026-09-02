import { MemoryFileSystem } from "../zeroperl.js";
import { gunzipSync } from "fflate";
import { unpackTar } from "modern-tar";
import pagiRunner from "../../bin/pagi-runner.pl";
import webdyneApp from "../../bin/webdyne-app.pl";
import futureIoZeroPerl from "../../lib/Future/IO/Impl/ZeroPerl.pm";

const VIRTUAL_ROOTS = new Set(["app", "perl5"]);

/** Validate a relative tar path before it becomes a virtual filesystem path. */
function virtualPath(name) {
  const normalized = name.replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe Perl VFS archive path: ${name}`);
  }
  // Build-1 applications used htdocs/ and app/local/lib/perl5/. Translate
  // those archive roots at the package boundary while keeping the runtime's
  // actual filesystem layout consistently rooted at /app and /perl5.
  if (normalized === "htdocs" || normalized.startsWith("htdocs/")) {
    return `/app${normalized.slice("htdocs".length)}`;
  }
  const legacyLibrary = "app/local/lib/perl5";
  if (normalized === legacyLibrary || normalized.startsWith(`${legacyLibrary}/`)) {
    return `/perl5/lib${normalized.slice(legacyLibrary.length)}`;
  }
  const [root] = normalized.split("/");
  if (!VIRTUAL_ROOTS.has(root)) {
    throw new Error(`Perl VFS archive path must begin with app/ or perl5/: ${name}`);
  }
  return `/${normalized}`;
}

/** Decompress and extract a deterministic tar.gz archive into the memory filesystem. */
async function unpackPerlVfs(archive, fileSystem) {
  const entries = await unpackTar(gunzipSync(new Uint8Array(archive)), { strict: true });
  for (const { header, data } of entries) {
    const path = virtualPath(header.name);
    if (header.type === "directory") {
      fileSystem.ensureDir(path);
    } else if (header.type === "file" && data) {
      // WebDyne uses mtimes for compile-cache identity and static ETags. Keep
      // the archive's stable timestamp instead of allowing stat() to report a
      // different Date.now() value for every lookup.
      const timestamp = header.mtime instanceof Date ? header.mtime.getTime() : 1;
      fileSystem.addFile(path, new File([data], path.split("/").at(-1), { lastModified: timestamp || 1 }));
    } else {
      throw new Error(`Unsupported Perl VFS tar entry: ${header.name}`);
    }
  }
}

/**
 * Build one provider-neutral ZeroPerl filesystem.
 *
 * `/zeroperl` is the immutable prefix embedded in the Wasm module. `/app`
 * contains the user's complete application tree, `/perl5` contains launchers
 * and optional application dependencies, and `/tmp` is deliberately writable.
 */
export async function createPerlFileSystem({ appVfsArchive, perlLibraryVfsArchive }) {
  const fileSystem = new MemoryFileSystem({ "/": "", "/zeroperl": "" });
  for (const directory of ["/app", "/dev", "/perl5", "/perl5/bin", "/perl5/lib", "/tmp"]) {
    fileSystem.ensureDir(directory);
  }

  await unpackPerlVfs(perlLibraryVfsArchive, fileSystem);
  await unpackPerlVfs(appVfsArchive, fileSystem);
  fileSystem.addFile("/perl5/lib/Future/IO/Impl/ZeroPerl.pm", futureIoZeroPerl);
  fileSystem.addFile("/perl5/bin/pagi-runner.pl", pagiRunner);
  fileSystem.addFile("/perl5/bin/webdyne-app.pl", webdyneApp);
  return fileSystem;
}
