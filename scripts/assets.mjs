import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

export const defaultAssetsIgnore = "*.psp\n*.pm\n*.pl\n*.conf\n";

// Wrangler 4.127.1 reads one root file, with these defaults, using node-ignore.
// Keep the matching order (including user negations) identical to Wrangler.
export async function readAssetsPolicy(directory) {
  async function inspect(current) {
    for (const child of await readdir(current, { withFileTypes: true })) {
      const filename = join(current, child.name);
      if (child.isSymbolicLink()) throw new Error(`Assets symlinks are not portable: ${filename}`);
      if (child.name === ".assetignore") {
        throw new Error(`Use .assetsignore (plural), not ${filename}`);
      }
      if (child.name === ".assetsignore" && current !== directory) {
        throw new Error(`Wrangler only reads ${join(directory, ".assetsignore")}; move rules from ${filename} there using root-relative patterns`);
      }
      if (child.isDirectory()) await inspect(filename);
    }
  }
  await inspect(directory);
  let contents;
  try {
    contents = await readFile(join(directory, ".assetsignore"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  const matcher = ignore().add(["/.assetsignore", "/_redirects", "/_headers"]).add(contents);
  return {
    directory,
    isPublic(filename) {
      const path = relative(directory, filename);
      if (!path || path === ".." || path.startsWith(`..${sep}`)) return false;
      return !matcher.ignores(path.replaceAll("\\", "/"));
    },
  };
}
