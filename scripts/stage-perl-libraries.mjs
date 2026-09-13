import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { access, stat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join, relative, resolve, sep } from "node:path";

const execute = promisify(execFile);

// Resolve host Perl using filesystem checks only: no probe subprocess and no
// module checks here. Use the resolved executable for staging so PATH lookup
// and invocation agree. The Perl helper diagnoses its own core dependencies.
export async function requireHostPerl(environment = process.env) {
  const name = process.platform === "win32" ? "perl.exe" : "perl";
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    if (!environment.PATH) break;
    const candidate = resolve(directory || ".", name);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) throw error;
    }
  }
  throw new Error("This build requires host Perl for managed libraries or CPAN dependencies. " +
    "Install Perl 5.18 or newer and ensure its executable is on PATH. " +
    "Applications with only explicit verbatim libraries do not require host Perl.");
}

// Keep the npm/archive boundary in JavaScript. The Perl process receives file
// paths and inventory JSON, not shell text. Each call owns a fresh stage, so a
// failed transformation cannot replace an installed dependency or a prior stage.
// The caller MUST invoke cleanup() in finally, including archive-write failures.
export async function stagePerlLibraries({ libraries, outputDirectory, embeddedFiles, sourceInventory, minify, runtime }) {
  const perl = await requireHostPerl();
  const output = resolve(outputDirectory);
  for (const library of libraries) {
    const path = relative(library, output);
    if (!path || (path !== ".." && !path.startsWith(`..${sep}`))) {
      throw new Error("Generated output must be outside Perl libraries");
    }
  }
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(output, ".perl-stage-"));
  const destination = join(temporary, "payload");
  await mkdir(destination);
  const cleanup = () => rm(temporary, { recursive: true, force: true });
  try {
    const request = join(temporary, "request.json");
    await writeFile(request, JSON.stringify({ libraries, destination, embeddedFiles, sourceInventory, minify, runtime }));
    const { stdout, stderr } = await execute(perl, [fileURLToPath(new URL("./stage-perl-libraries.pl", import.meta.url)), request], {
      maxBuffer: 64 * 1024 * 1024,
    });
    // Successful auto fallback writes a warning; do not lose subprocess diagnostics.
    if (stderr) process.stderr.write(stderr);
    const result = JSON.parse(stdout);
    return { ...result, directory: destination, cleanup };
  } catch (error) {
    await cleanup();
    if (error.code === "ENOENT") throw new Error(`Could not start host Perl at ${perl}; check that the executable and its runtime dependencies are installed`, { cause: error });
    throw error;
  }
}

// Missing inventories from older runtimes do not justify guessing module
// compatibility. Their builds retain byte-identical deduplication only.
export async function readSourceInventory(packageRoot) {
  try {
    const inventory = JSON.parse(await readFile(join(packageRoot, "library-sources.json"), "utf8"));
    if (inventory.schema !== 1) throw new Error("Unsupported library source inventory schema");
    return inventory;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
