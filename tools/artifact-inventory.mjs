import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

export async function directoryInventory(root) {
  const paths = [];
  let bytes = 0;

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        paths.push(path);
        bytes += (await stat(path)).size;
      }
    }
  }

  await visit(root);
  paths.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
  const treeHash = createHash("sha256");
  for (const path of paths) {
    treeHash.update(relative(root, path));
    treeHash.update("\0");
    treeHash.update(await readFile(path));
    treeHash.update("\0");
  }
  return { files: paths.length, bytes, sha256: treeHash.digest("hex") };
}

