function extensionName(extension, index) {
  return typeof extension.name === "string" && extension.name.length > 0
    ? extension.name
    : `extension-${index + 1}`;
}

function cleanupFunction(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "function") return value;
  if (typeof value.release === "function") return (context) => value.release(context);
  throw new TypeError(`${name}.attachScope() must return a cleanup function, a release object, or nothing`);
}

/**
 * Validate and coordinate optional runtime extensions without teaching the
 * provider-neutral WebDyne runtime about any particular edge service.
 *
 * Extension registration is interpreter-generation scoped. Scope attachment
 * is request scoped and deliberately synchronous so a Fetch handler can
 * return its Response immediately. The manager returns an attachment Promise
 * so partial-attachment failure can await cleanup. Release invokes every cleanup
 * synchronously in reverse order, then awaits their completion with a deadline.
 */
export function createExtensionManager(extensions = [], { cleanupTimeoutMs = 10_000 } = {}) {
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 2_147_483_647) {
    throw new TypeError("cleanupTimeoutMs must be an integer from 1 to 2147483647");
  }
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

    async attachScope(context) {
      const cleanups = [];
      let completion;

      const release = () => {
        if (completion) return completion;
        const controller = new AbortController();
        const errors = [];
        let resolveCompletion;
        let rejectCompletion;
        completion = new Promise((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        });
        // Observe even when a custom caller ignores release's returned Promise.
        void completion.catch(() => undefined);
        const timer = setTimeout(() => {
          const error = new Error(`WebDyne extension cleanup exceeded ${cleanupTimeoutMs} ms`);
          error.name = "ExtensionCleanupTimeoutError";
          controller.abort(error);
          rejectCompletion(errors.length
            ? new AggregateError([...errors, error], "WebDyne extension cleanup failed")
            : error);
        }, cleanupTimeoutMs);
        const pending = [];
        // Invoke all hooks before yielding: capabilities must be revoked now,
        // even if another extension's asynchronous resource close is stalled.
        for (const cleanup of cleanups.reverse()) {
          try {
            pending.push(Promise.resolve(cleanup({ signal: controller.signal })).catch((error) => {
              errors.push(error);
            }));
          } catch (error) {
            errors.push(error);
          }
        }
        void Promise.all(pending).then(() => {
          clearTimeout(timer);
          if (errors.length === 1) rejectCompletion(errors[0]);
          else if (errors.length > 1) rejectCompletion(new AggregateError(errors, "WebDyne extension cleanup failed"));
          else resolveCompletion();
        });
        return completion;
      };

      try {
        for (const { extension, name } of installed) {
          const cleanup = cleanupFunction(extension.attachScope?.({ ...context, lifecycle: { asyncCleanup: true } }), name);
          if (cleanup) cleanups.push(cleanup);
        }
      } catch (error) {
        try {
          await release();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "WebDyne extension attachment failed during cleanup");
        }
        throw error;
      }
      return release;
    },
  };
}
