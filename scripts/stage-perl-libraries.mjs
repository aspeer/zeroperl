import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const execute = promisify(execFile);

// Keep the npm/archive boundary in JavaScript. The Perl process receives file
// paths and inventory JSON, not shell text. Each call owns a fresh stage, so a
// failed transformation cannot replace an installed dependency or a prior stage.
// The caller MUST invoke cleanup() in finally, including archive-write failures.
export async function stagePerlLibraries({ libraries, outputDirectory, embeddedFiles, sourceInventory, minify, runtime }) {
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
    const { stdout } = await execute("perl", [fileURLToPath(new URL("./stage-perl-libraries.pl", import.meta.url)), request], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    return { ...result, directory: destination, cleanup };
  } catch (error) {
    await cleanup();
    if (error.code === "ENOENT") throw new Error("Perl library staging requires host Perl; no-library applications do not require it", { cause: error });
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
