const PERL_LIBRARY_DIR = "/perl5/lib";

/** Select text bindings that are safe to expose through Perl's WASI environment. */
function webdynePerlEnvironment(bindings = {}) {
  const environment = Object.fromEntries(
    Object.entries(bindings)
      .filter(([name, value]) => name.startsWith("WEBDYNE_") && typeof value === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    ...environment,
    PERL5LIB: PERL_LIBRARY_DIR,
    TMPDIR: "/tmp",
  };
}

/** Parse provider bindings into one interpreter's fixed WebDyne configuration. */
export function webdyneRuntimeConfig(bindings = {}) {
  const flag = (value, fallback = 0) => {
    if (value === undefined) return fallback;
    return /^(?:1|true|yes|on)$/i.test(String(value)) ? 1 : 0;
  };
  const root = typeof bindings.WEBDYNE_ROOT === "string" && bindings.WEBDYNE_ROOT.startsWith("/")
    ? bindings.WEBDYNE_ROOT
    : "/app";
  const index = bindings.WEBDYNE_INDEX === "1" ? 1
    : typeof bindings.WEBDYNE_INDEX === "string" && bindings.WEBDYNE_INDEX.length > 0
      ? bindings.WEBDYNE_INDEX
      : "app.psp";
  return {
    root,
    index,
    static: flag(bindings.WEBDYNE_STATIC, 1),
    conf: flag(bindings.WEBDYNE_CONF),
    perlEnv: webdynePerlEnvironment(bindings),
  };
}
