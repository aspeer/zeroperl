import { readFile } from "node:fs/promises";

// Match the package's bundler text imports when running source under Node.
export async function load(url, context, nextLoad) {
  if (/\.(pl|pm)$/.test(url)) {
    return {
      format: "module",
      source: `export default ${JSON.stringify(await readFile(new URL(url), "utf8"))}`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
