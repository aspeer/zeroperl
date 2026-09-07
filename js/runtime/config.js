const PERL_LIBRARY_DIR = "/perl5/lib";

/** Callback settings are qualified Perl function names, never Perl expressions. */
export function lifespanCallbackName(value, description) {
  if (typeof value !== "string" || value !== value.trim()
    || !/^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+$/.test(value)) {
    throw new TypeError(`${description} must be a qualified Perl function name, such as My::App::startup (without parentheses)`);
  }
  return value;
}

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
  const callbacks = {};
  for (const phase of ["startup", "shutdown"]) {
    const name = `WEBDYNE_${phase.toUpperCase()}`;
    if (bindings[name] !== undefined) callbacks[phase] = lifespanCallbackName(bindings[name], name);
  }
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
    ...callbacks,
    perlEnv: webdynePerlEnvironment(bindings),
  };
}

/** Encode data for Perl source without double-quoted string interpolation. */
export function perlJsonExpression(value) {
  const hex = Array.from(new TextEncoder().encode(JSON.stringify(value)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `JSON::PP->new->utf8->decode(pack('H*', '${hex}'))`;
}
