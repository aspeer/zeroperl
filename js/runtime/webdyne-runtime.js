import { ZeroPerl } from "../zeroperl.js";
import { createPerlFileSystem } from "./perl-filesystem.js";
import { webdyneRuntimeConfig } from "./config.js";
import {
  buildPagiScope,
  createDisconnectDispatcher,
  createFetchPagiTransport,
  createReceiveDispatcher,
  createTimerRegistry,
  diagnosticExcerpt,
  serializePagiScope,
} from "../transport/fetch-pagi.js";

const decoder = new TextDecoder();
const PAGI_RUNNER = "/perl5/bin/pagi-runner.pl";
const WEBDYNE_APPLICATION = "/perl5/bin/webdyne-app.pl";

/** Identify local development requests where concise diagnostics are safe. */
function showFailureDetails(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Create a provider-neutral WebDyne/PAGI runtime around one ZeroPerl module.
 *
 * The returned object accepts Fetch requests because Fetch is the shared edge
 * transport boundary. Provider lifecycle and WebSocket semantics are injected
 * as capabilities and remain outside this module.
 */
export function createWebDyneRuntime({
  zeroperlModule,
  appVfsArchive,
  perlLibraryVfsArchive,
  webSocketAdapter,
}) {
  if (!(zeroperlModule instanceof WebAssembly.Module)) {
    throw new TypeError("zeroperlModule must be an imported WebAssembly.Module");
  }
  if (!(appVfsArchive instanceof ArrayBuffer)) {
    throw new TypeError("appVfsArchive must be an imported ArrayBuffer");
  }
  if (!(perlLibraryVfsArchive instanceof ArrayBuffer)) {
    throw new TypeError("perlLibraryVfsArchive must be an imported ArrayBuffer");
  }

  const assets = { appVfsArchive, perlLibraryVfsArchive };
  let perlFileSystemPromise;
  let persistentRuntimePromise;
  let persistentPerl;
  let persistentPerlQueue = Promise.resolve();
  let persistentRuntimeResetPromise;
  let persistentRuntimeGeneration = 1;
  let persistentRuntimeConfigKey;
  let nextPagiSessionId = 1;
  let nextPagiErrorId = 1;
  const pagiSessions = new Map();

  function getPerlFileSystem() {
    perlFileSystemPromise ??= createPerlFileSystem(assets);
    return perlFileSystemPromise;
  }

  /** Attach a stable diagnostic ID without exposing request data by default. */
  function describePagiFailure(session, error, phase = "application") {
    const normalized = error instanceof Error ? error : new Error(String(error));
    normalized.pagiErrorId ??= `pagi-${nextPagiErrorId++}`;
    normalized.pagiPhase ??= phase;
    normalized.pagiExpose ??= session?.showFailureDetails === true;
    return normalized;
  }

  /** Enter one interpreter generation exclusively; calls are short session turns. */
  function enqueuePersistentPerl(session, name, buildArgs) {
    const generation = session.runtimeGeneration;
    const task = persistentPerlQueue.then(async () => {
      if (session.finished) return;
      if (!persistentPerl || generation !== persistentRuntimeGeneration) return;
      let values;
      try {
        values = buildArgs(persistentPerl);
        await persistentPerl.call(name, values.args, "void");
        persistentPerl.clearError();
      } finally {
        values?.dispose();
      }
    });
    // A rejected entry can leave Asyncify state unusable. Settle the queue and
    // retire the complete generation rather than reusing a poisoned instance.
    persistentPerlQueue = task.catch(() => undefined);
    return task.catch((error) => {
      const failure = describePagiFailure(session, error, `perl.${name}`);
      void resetPersistentRuntime(failure);
      throw error;
    });
  }

  function stopPagiSession(session) {
    session.receiveDispatcher?.stop();
    session.disconnectDispatcher?.stop();
    session.timers?.cancelAll();
    pagiSessions.delete(session.id);
  }

  function finishPagiSession(session) {
    if (session.finished) return;
    session.finished = true;
    stopPagiSession(session);
    if (!session.sink.started || (!session.sink.finished && session.connection.status().connected)) {
      session.reject(new Error("PAGI app completed without a final response event"));
    } else {
      session.resolve();
    }
  }

  /** Schedule Perl cleanup without requiring the failed connection to be live. */
  function abortPersistentSession(session) {
    if (!persistentPerl || session.runtimeGeneration !== persistentRuntimeGeneration) return;
    const generation = session.runtimeGeneration;
    const task = persistentPerlQueue.then(async () => {
      if (!persistentPerl || generation !== persistentRuntimeGeneration) return;
      const sessionValue = persistentPerl.createInt(session.id);
      try {
        await persistentPerl.call("Pagi::ZeroPerl::Runner::abort_session", [sessionValue], "void");
        persistentPerl.clearError();
      } finally {
        sessionValue.dispose();
      }
    });
    persistentPerlQueue = task.catch(() => undefined);
    void task.catch((error) => resetPersistentRuntime(describePagiFailure(session, error, "perl.abort_session")));
  }

  function failPagiSession(session, error, { abort = true } = {}) {
    if (session.finished) return;
    session.finished = true;
    stopPagiSession(session);
    const normalized = describePagiFailure(session, error);
    if (abort) abortPersistentSession(session);
    console.error("PAGI session failed", {
      errorId: normalized.pagiErrorId,
      phase: normalized.pagiPhase,
      method: session.scope?.method,
      path: session.scope?.raw_path,
      message: diagnosticExcerpt(normalized, 1024),
    });
    session.reject(normalized);
    void session.sink.fail(normalized);
  }

  /** Dispose a poisoned interpreter and fail every dependent session. */
  function resetPersistentRuntime(error) {
    if (persistentRuntimeResetPromise) return persistentRuntimeResetPromise;

    const oldPerl = persistentPerl;
    const poisonedGeneration = persistentRuntimeGeneration;
    persistentPerl = undefined;
    persistentRuntimePromise = undefined;
    persistentRuntimeConfigKey = undefined;
    persistentRuntimeGeneration += 1;
    persistentPerlQueue = Promise.resolve();

    for (const session of [...pagiSessions.values()]) {
      if (session.runtimeGeneration === poisonedGeneration) {
        failPagiSession(session, error, { abort: false });
      }
    }

    persistentRuntimeResetPromise = Promise.resolve().then(() => {
      try { oldPerl?.dispose(); } catch (disposeError) {
        console.error("Unable to dispose poisoned ZeroPerl runtime", disposeError);
      }
    }).finally(() => {
      persistentRuntimeResetPromise = undefined;
    });
    return persistentRuntimeResetPromise;
  }

  function sessionForHost(idValue) {
    const session = pagiSessions.get(idValue.toInt());
    if (!session || session.finished) throw new Error("PAGI session is no longer active");
    return session;
  }

  /** Register bridge functions once; the first argument selects the session. */
  function registerPersistentHostFunctions(perl) {
    perl.registerFunction("worker_send_event", async (sessionId, eventJson) => {
      const session = sessionForHost(sessionId);
      if (!session.connection.status().connected) throw new Error("PAGI client disconnected");
      await session.sink.send(JSON.parse(eventJson.toString()));
      return perl.createUndef();
    });
    perl.registerFunction("worker_receive_register", (sessionId) => (
      perl.createInt(sessionForHost(sessionId).receiveDispatcher.register())
    ));
    perl.registerFunction("worker_receive_cancel", (sessionId, receiveId) => {
      sessionForHost(sessionId).receiveDispatcher.cancel(receiveId.toInt());
      return perl.createUndef();
    });
    perl.registerFunction("worker_disconnect_register", (sessionId) => (
      perl.createInt(sessionForHost(sessionId).disconnectDispatcher.register())
    ));
    perl.registerFunction("worker_disconnect_cancel", (sessionId, disconnectId) => {
      sessionForHost(sessionId).disconnectDispatcher.cancel(disconnectId.toInt());
      return perl.createUndef();
    });
    perl.registerFunction("worker_connection_status", (sessionId) => {
      const session = pagiSessions.get(sessionId.toInt());
      return perl.createString(JSON.stringify(session?.connection.status() ?? {
        connected: false,
        reason: "session_finished",
      }));
    });
    perl.registerFunction("worker_timer_start", (sessionId, milliseconds) => (
      perl.createInt(sessionForHost(sessionId).timers.start(milliseconds.toInt()))
    ));
    perl.registerFunction("worker_timer_cancel", (sessionId, timerId) => {
      sessionForHost(sessionId).timers.cancel(timerId.toInt());
      return perl.createUndef();
    });
    perl.registerFunction("worker_application_finished", (sessionId, statusJson) => {
      const session = pagiSessions.get(sessionId.toInt());
      if (!session || session.finished) return perl.createUndef();
      const status = JSON.parse(statusJson.toString());
      if (status.error) {
        const failure = describePagiFailure(
          session,
          new Error(status.error),
          `application.${status.phase ?? "finish"}`,
        );
        failPagiSession(session, failure);
        void persistentPerlQueue.then(() => resetPersistentRuntime(failure));
      } else {
        finishPagiSession(session);
      }
      return perl.createUndef();
    });
  }

  /** Create and bootstrap exactly one interpreter for this provider instance. */
  async function createPersistentRuntime(config) {
    const generation = persistentRuntimeGeneration;
    const { perlEnv, ...applicationConfig } = config;
    const perl = await ZeroPerl.create({
      fileSystem: await getPerlFileSystem(),
      wasmModule: zeroperlModule,
      env: perlEnv,
      stdout: (chunk) => console.log("zeroperl:", typeof chunk === "string" ? chunk : decoder.decode(chunk)),
      stderr: (chunk) => console.error("zeroperl:", typeof chunk === "string" ? chunk : decoder.decode(chunk)),
    });
    try {
      persistentPerl = perl;
      registerPersistentHostFunctions(perl);
      const bootstrapJson = JSON.stringify({ applicationConfig, perlEnv });
      const configure = await perl.eval(
        `require JSON::PP;
         my $bootstrap = JSON::PP->new->decode(${JSON.stringify(bootstrapJson)});
         while (my ($name, $value) = each %{$bootstrap->{perlEnv}}) {
           $ENV{$name} = $value;
         }
         for my $library (reverse split(/:/, $bootstrap->{perlEnv}->{PERL5LIB} // '')) {
           unshift @INC, $library if length($library) && !grep { $_ eq $library } @INC;
         }
         $Pagi::WebDyne::CONFIG = $bootstrap->{applicationConfig};`,
      );
      if (!configure.success) throw new Error(configure.error);
      for (const file of [PAGI_RUNNER, WEBDYNE_APPLICATION]) {
        const load = await perl.runFile(file);
        if (!load.success) throw new Error(load.error);
      }
      return { perl, generation };
    } catch (error) {
      persistentPerl = undefined;
      perl.dispose();
      throw error;
    }
  }

  async function persistentRuntime(config) {
    if (persistentRuntimeResetPromise) await persistentRuntimeResetPromise;
    const configKey = JSON.stringify(config);
    if (persistentRuntimeConfigKey && persistentRuntimeConfigKey !== configKey) {
      throw new Error("WebDyne runtime bindings changed within one provider instance");
    }
    persistentRuntimeConfigKey ??= configKey;
    persistentRuntimePromise ??= createPersistentRuntime(config).catch((error) => {
      persistentRuntimePromise = undefined;
      persistentRuntimeConfigKey = undefined;
      throw error;
    });
    return persistentRuntimePromise;
  }

  function createPagiSession(scope, request, transport) {
    let resolve;
    let reject;
    const session = {
      id: nextPagiSessionId++,
      scope,
      sink: transport.sink,
      connection: transport.connection,
      finished: false,
      runtimeGeneration: undefined,
      showFailureDetails: showFailureDetails(request),
      completion: new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; }),
      resolve: () => resolve(),
      reject: (error) => reject(error),
    };
    session.receiveDispatcher = createReceiveDispatcher(
      transport.receiveSource,
      (receiveId, event) => queueReceive(session, receiveId, event),
      (error) => failPagiSession(session, error),
    );
    session.disconnectDispatcher = createDisconnectDispatcher(
      transport.connection,
      (disconnectId, reason) => queueDisconnect(session, disconnectId, reason),
      (error) => failPagiSession(session, error),
    );
    session.timers = createTimerRegistry((timerId) => queueTimer(session, timerId));
    return session;
  }

  function queueReceive(session, receiveId, event) {
    if (session.finished) return Promise.resolve();
    return enqueuePersistentPerl(session, "Pagi::ZeroPerl::Runner::deliver_receive", (perl) => {
      const sessionValue = perl.createInt(session.id);
      const receiveValue = perl.createInt(receiveId);
      const eventValue = perl.createString(JSON.stringify(event));
      return {
        args: [sessionValue, receiveValue, eventValue],
        dispose: () => { sessionValue.dispose(); receiveValue.dispose(); eventValue.dispose(); },
      };
    });
  }

  function queueTimer(session, timerId) {
    if (session.finished) return Promise.resolve();
    return enqueuePersistentPerl(session, "Pagi::ZeroPerl::Runner::deliver_timer", (perl) => {
      const sessionValue = perl.createInt(session.id);
      const timerValue = perl.createInt(timerId);
      return {
        args: [sessionValue, timerValue],
        dispose: () => { sessionValue.dispose(); timerValue.dispose(); },
      };
    });
  }

  function queueDisconnect(session, disconnectId, reason) {
    if (session.finished) return Promise.resolve();
    return enqueuePersistentPerl(session, "Pagi::ZeroPerl::Connection::deliver_disconnect", (perl) => {
      const sessionValue = perl.createInt(session.id);
      const disconnectValue = perl.createInt(disconnectId);
      const reasonValue = perl.createString(reason);
      return {
        args: [sessionValue, disconnectValue, reasonValue],
        dispose: () => { sessionValue.dispose(); disconnectValue.dispose(); reasonValue.dispose(); },
      };
    });
  }

  async function startPersistentSession(scope, request, transport, runtimeConfig) {
    const session = createPagiSession(scope, request, transport);
    pagiSessions.set(session.id, session);
    try {
      const runtime = await persistentRuntime(runtimeConfig);
      session.runtimeGeneration = runtime.generation;
      await enqueuePersistentPerl(session, "Pagi::ZeroPerl::Runner::start_session", (perl) => {
        const sessionValue = perl.createInt(session.id);
        // The scope crosses the ABI as an owned JSON value. WebDyne can safely
        // decorate the decoded Perl graph without retaining JS-owned values.
        const scopeValue = perl.createString(serializePagiScope(scope));
        const entrypointValue = perl.createString("Pagi::WebDyne::application");
        return {
          args: [sessionValue, scopeValue, entrypointValue],
          dispose: () => {
            sessionValue.dispose();
            scopeValue.dispose();
            entrypointValue.dispose();
          },
        };
      });
      return session.completion;
    } catch (error) {
      failPagiSession(session, error);
      throw error;
    }
  }

  function dispatch(request, bindings = {}) {
    const scope = buildPagiScope(request);
    const transport = createFetchPagiTransport(scope, request, { webSocketAdapter });
    const completion = startPersistentSession(
      scope,
      request,
      transport,
      webdyneRuntimeConfig(bindings),
    ).catch((error) => {
      if (!error?.pagiErrorId) console.error("PAGI application failed:", error);
    });
    return { response: transport.response, completion, type: scope.type };
  }

  return { dispatch };
}
