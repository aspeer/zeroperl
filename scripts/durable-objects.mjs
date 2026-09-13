/** Validate application definitions before emitting code or deployment configuration. */
export function durableObjects(value = []) {
  if (!Array.isArray(value)) throw new TypeError("webdyne.cloudflare.durableObjects must be an array");
  const bindings = new Set();
  const classes = new Set();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some(key => !["binding", "className", "scriptName", "perlPackage", "methods", "initialize", "native"].includes(key))
      || !/^[A-Z_][A-Z0-9_]*$/.test(item.binding ?? "")
      || !/^[A-Z][A-Za-z0-9_]*$/.test(item.className ?? "")
      || ["default", "createCloudflareWorker", "createWebDyneRuntime", "createWebDyneDurableObject", "zeroperlModule", "appVfsArchive", "perlLibraryVfsArchive", "webdyneExtensions"].includes(item.className)
      || bindings.has(item.binding)) throw new TypeError("Invalid or duplicate Durable Object binding/class");
    bindings.add(item.binding);
    if (item.scriptName !== undefined) {
      if (typeof item.scriptName !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.scriptName)
        || item.perlPackage !== undefined || item.methods !== undefined || item.initialize !== undefined
        || (item.native !== undefined && typeof item.native !== "boolean")) throw new TypeError("Invalid external Durable Object definition");
    } else {
      if (classes.has(item.className) || item.native !== undefined
        || !/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(item.perlPackage ?? "")
        || !Array.isArray(item.methods) || !item.methods.length || new Set(item.methods).size !== item.methods.length
        || item.methods.some(method => typeof method !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(method)
          || ["constructor", "prototype", "then", "fetch", "alarm", "webSocketMessage", "webSocketClose", "webSocketError", "webdyneInvoke", "initialize", "DESTROY", "AUTOLOAD"].includes(method))
        || (item.initialize !== undefined && typeof item.initialize !== "boolean")) throw new TypeError("Invalid local Durable Object definition");
      classes.add(item.className);
    }
    return { ...item };
  });
}

export function durableWranglerConfig(objects) {
  if (!objects.length) return {};
  const local = objects.filter(item => !item.scriptName);
  return {
    durable_objects: { bindings: objects.map(item => ({ name: item.binding, class_name: item.className,
      ...(item.scriptName ? { script_name: item.scriptName } : {}) })) },
    ...(local.length ? { exports: Object.fromEntries(local.map(item => [item.className, { type: "durable-object", storage: "sqlite" }])) } : {}),
  };
}

function bindingOptions(value = []) {
  const names = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!names || names.some(name => typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(name.trim()))) {
    throw new TypeError("Durable Object binding options must be binding names");
  }
  return names.map(name => name.trim());
}

export function configureDurableExtensions(objects, extensions) {
  if (!objects.length) return;
  const extension = extensions.find(item => item.packageName === "@webdyne/webdyne-cloudflare");
  if (!extension) throw new Error("Durable Objects require the @webdyne/webdyne-cloudflare extension");
  extension.options = { ...extension.options,
    durableObjectBindings: [...new Set([...bindingOptions(extension.options.durableObjectBindings), ...objects.map(item => item.binding)])],
    durableObjectNativeBindings: [...new Set([...bindingOptions(extension.options.durableObjectNativeBindings), ...objects.filter(item => item.native).map(item => item.binding)])],
  };
}

export function durableWorkerSource(objects, distributionName, extensionDeclaration) {
  const local = objects.filter(item => !item.scriptName);
  if (!local.length) return "";
  return `import { createWebDyneRuntime } from ${JSON.stringify(`${distributionName}/runtime`)};
import { createWebDyneDurableObject } from "@webdyne/webdyne-cloudflare/durable-object";
${local.map(item => `export const ${item.className} = createWebDyneDurableObject({
  createRuntime: createWebDyneRuntime,
  runtimeOptions: { zeroperlModule, appVfsArchive, perlLibraryVfsArchive },
  definition: ${JSON.stringify({ perlPackage: item.perlPackage, methods: item.methods, initialize: item.initialize ?? false })},
  createExtensions: () => { ${extensionDeclaration.replace("const webdyneExtensions =", "return")} },
});`).join("\n")}
`;
}
