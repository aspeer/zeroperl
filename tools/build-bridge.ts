import { resolve } from "node:path";

// Build the package's embedded bridge from the canonical checkout. The host
// supplies its versioned WebAssembly.Module, so no duplicate WASM is emitted.
const bridge = resolve(process.argv[2] ?? "zeroperl-ts");
const result = await Bun.build({
  entrypoints: [resolve(bridge, "index.ts")],
  outdir: "js",
  naming: "zeroperl.js",
  target: "browser",
  format: "esm",
  minify: true,
  plugins: [{
    name: "runtime-wasm-location",
    setup(build) {
      build.onResolve({ filter: /\.wasm$/ }, ({ path }) => ({
        path,
        namespace: "external-runtime",
      }));
      build.onLoad({ filter: /\.wasm$/, namespace: "external-runtime" }, () => ({
        contents: 'export default "./zeroperl.wasm";',
        loader: "js",
      }));
    },
  }],
});
if (!result.success) throw new AggregateError(result.logs, "Bridge build failed");

// Keep the cross-version qualification probe with the generated bridge so
// release CI does not depend on access to an unpublished source submodule.
const lifecycle = await Bun.file(resolve(bridge, "tools/check-runtime-lifecycle.mjs")).text();
await Bun.write("tools/check-runtime-lifecycle.mjs", lifecycle.replace("\n",
  "\n// Generated from zeroperl-ts by tools/build-bridge.ts; edit the canonical source.\n"));
