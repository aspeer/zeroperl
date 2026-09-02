import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const exportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

/** Normalize the explicit project configuration into deterministic entries. */
export function extensionConfiguration(value) {
  if (value === undefined) return [];
  let entries;
  if (Array.isArray(value)) {
    entries = value.map((packageName) => [packageName, {}]);
  } else if (isObject(value)) {
    entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  } else {
    throw new TypeError("package.json webdyne.extensions must be an array or object");
  }

  const seen = new Set();
  return entries.map(([packageName, options]) => {
    if (typeof packageName !== "string" || !packageNamePattern.test(packageName)) {
      throw new TypeError(`Invalid WebDyne extension package name: ${packageName}`);
    }
    if (seen.has(packageName)) throw new Error(`Duplicate WebDyne extension: ${packageName}`);
    if (!isObject(options)) throw new TypeError(`Configuration for ${packageName} must be an object`);
    seen.add(packageName);
    return { packageName, options };
  });
}

/**
 * Resolve declarative extension metadata from direct npm dependencies.
 * No package lifecycle or discovery code executes during this step.
 */
export async function resolveWebDyneExtensions(projectRoot, packageJson, configuredExtensions) {
  const root = resolve(projectRoot);
  const declaredDependencies = packageJson.dependencies ?? {};
  const requireFromProject = createRequire(resolve(root, "package.json"));
  const resolved = [];

  for (const configured of configuredExtensions) {
    const { packageName, options } = configured;
    if (!Object.hasOwn(declaredDependencies, packageName)) {
      throw new Error(`${packageName} must be a direct package.json dependency to enable it as a WebDyne extension`);
    }

    let manifestPath;
    try {
      manifestPath = requireFromProject.resolve(`${packageName}/webdyne-extension.json`);
    } catch (error) {
      throw new Error(`Unable to resolve ${packageName}/webdyne-extension.json: ${error.message}`);
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.schemaVersion !== 1) {
      throw new Error(`${packageName} uses unsupported WebDyne extension schema ${manifest.schemaVersion}`);
    }
    if (typeof manifest.perlLibrary !== "string" || manifest.perlLibrary.length === 0) {
      throw new Error(`${packageName} extension manifest must declare perlLibrary`);
    }
    const cloudflare = manifest.providers?.cloudflare;
    if (!isObject(cloudflare)
      || typeof cloudflare.module !== "string"
      || !/^\.\/[A-Za-z0-9._/-]+$/.test(cloudflare.module)
      || cloudflare.module.split("/").includes("..")
      || typeof cloudflare.factory !== "string"
      || !exportNamePattern.test(cloudflare.factory)) {
      throw new Error(`${packageName} extension manifest has no valid Cloudflare provider export`);
    }

    const packageRoot = await realpath(dirname(manifestPath));
    const perlLibrary = await realpath(resolve(packageRoot, manifest.perlLibrary));
    if (!isInside(packageRoot, perlLibrary)) {
      throw new Error(`${packageName} Perl library escapes its npm package`);
    }
    resolved.push({
      packageName,
      options,
      perlLibrary,
      importSpecifier: `${packageName}/${cloudflare.module.slice(2)}`,
      factory: cloudflare.factory,
    });
  }
  return resolved;
}

/** Emit static imports so Wrangler can bundle extension code normally. */
export function extensionWorkerSource(extensions) {
  const imports = extensions.map((extension, index) => (
    `import { ${extension.factory} as webdyneExtensionFactory${index} } from ${JSON.stringify(extension.importSpecifier)};`
  ));
  const factories = extensions.map((extension, index) => (
    `  webdyneExtensionFactory${index}(${JSON.stringify(extension.options)})`
  ));
  return {
    imports: imports.length > 0 ? `${imports.join("\n")}\n` : "",
    declaration: `const webdyneExtensions = [\n${factories.join(",\n")}\n];`,
  };
}
