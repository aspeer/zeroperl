import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command, arguments_, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function dependencyState(root) {
  const digest = createHash("sha256");
  for (const name of ["cpanfile", "cpanfile.snapshot"]) {
    const path = resolve(root, name);
    digest.update(`${name}\0`);
    if (await exists(path)) digest.update(await readFile(path));
    digest.update("\0");
  }
  return { schema: 1, sha256: digest.digest("hex") };
}

/**
 * Install an optional root cpanfile into an isolated local::lib tree.
 *
 * Carton is preferred because it can honour cpanfile.snapshot. cpanminus is a
 * pragmatic fallback. The resulting tree is inspected later and any native
 * host extension is rejected before it can enter the Wasm VFS.
 */
export async function installCpanDependencies({ projectRoot, outputDirectory }) {
  const root = resolve(projectRoot);
  const cpanfile = resolve(root, "cpanfile");
  if (!(await exists(cpanfile))) return undefined;

  const output = resolve(outputDirectory);
  const installRoot = resolve(output, "cpan");
  const library = resolve(installRoot, "lib/perl5");
  const statePath = resolve(installRoot, ".webdyne-cpan-state.json");
  if (!isInside(output, installRoot)) throw new Error("Unsafe CPAN installation directory");
  const expectedState = await dependencyState(root);
  if (await exists(library) && await exists(statePath)) {
    try {
      const installedState = JSON.parse(await readFile(statePath, "utf8"));
      if (installedState.schema === expectedState.schema && installedState.sha256 === expectedState.sha256) {
        console.log("Using cached Pure-Perl dependencies from .webdyne/cpan");
        return library;
      }
    } catch {
      // An interrupted or obsolete cache is rebuilt below.
    }
  }

  await rm(installRoot, { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });

  const environment = {
    ...process.env,
    PERL_CPANM_HOME: resolve(output, "cpanm-work"),
  };

  try {
    await run("carton", ["install", "--path", installRoot], { cwd: root, env: environment });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await run("cpanm", ["--notest", "--local-lib-contained", installRoot, "--installdeps", "."], {
        cwd: root,
        env: environment,
      });
    } catch (fallbackError) {
      if (fallbackError?.code === "ENOENT") {
        throw new Error("A root cpanfile requires Carton or cpanminus to install its Pure-Perl dependencies");
      }
      throw fallbackError;
    }
  }

  if (!(await exists(library))) {
    throw new Error("The CPAN installer completed without creating a local Perl library");
  }
  // Carton may create cpanfile.snapshot during the first install. Hash the
  // post-install inputs so the very next unchanged build can use the cache.
  await writeFile(statePath, `${JSON.stringify(await dependencyState(root), null, 2)}\n`);
  return library;
}
