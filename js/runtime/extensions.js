function extensionName(extension, index) {
  return typeof extension.name === "string" && extension.name.length > 0
    ? extension.name
    : `extension-${index + 1}`;
}

function cleanupFunction(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "function") return value;
  if (typeof value.release === "function") return () => value.release();
  throw new TypeError(`${name}.attachScope() must return a cleanup function, a release object, or nothing`);
}

/**
 * Validate and coordinate optional runtime extensions without teaching the
 * provider-neutral WebDyne runtime about any particular edge service.
 *
 * Extension registration is interpreter-generation scoped. Scope attachment
 * is request scoped and deliberately synchronous so a Fetch handler can
 * return its Response immediately. Cleanups execute once in reverse order.
 */
export function createExtensionManager(extensions = []) {
  if (!Array.isArray(extensions)) throw new TypeError("extensions must be an array");
  const installed = extensions.map((extension, index) => {
    if (!extension || typeof extension !== "object" || Array.isArray(extension)) {
      throw new TypeError(`extension ${index + 1} must be an object`);
    }
    for (const method of ["register", "attachScope"]) {
      if (extension[method] !== undefined && typeof extension[method] !== "function") {
        throw new TypeError(`${extensionName(extension, index)}.${method} must be a function`);
      }
    }
    return { extension, name: extensionName(extension, index) };
  });

  return {
    register(perl) {
      for (const { extension } of installed) extension.register?.(perl);
    },

    attachScope(context) {
      const cleanups = [];
      let released = false;

      const release = () => {
        if (released) return;
        released = true;
        const errors = [];
        for (const cleanup of cleanups.reverse()) {
          try {
            cleanup();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "WebDyne extension cleanup failed");
      };

      try {
        for (const { extension, name } of installed) {
          const cleanup = cleanupFunction(extension.attachScope?.(context), name);
          if (cleanup) cleanups.push(cleanup);
        }
      } catch (error) {
        try {
          release();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "WebDyne extension attachment failed during cleanup");
        }
        throw error;
      }
      return release;
    },
  };
}
