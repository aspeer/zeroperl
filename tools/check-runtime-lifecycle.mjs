#!/usr/bin/env node
// Generated from zeroperl-ts by tools/build-bridge.ts; edit the canonical source.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { ZeroPerl } = await import(process.argv[3]
    ? pathToFileURL(resolve(process.argv[3])).href : new URL("../dist/esm/index.js", import.meta.url).href);

// Accept an external candidate to qualify each supported Perl build before
// copying a binary into the npm package.
const runtime = await readFile(process.argv[2] ?? new URL("../zeroperl.wasm", import.meta.url));
const create = () => ZeroPerl.create({ fetch: async () => new Response(runtime) });
const perl = await create();
const evaluate = async code => {
    if (process.env.ZEROPERL_LIFECYCLE_TRACE) console.log(code.slice(0, 160));
    const result = await perl.eval(code);
    assert.equal(result.success, true, result.error);
};
let assertions = 0;
let failure;
try {
    let borrowed;
    let returned;
    perl.registerFunction("identity", value => { borrowed = value; return value; });
    perl.registerFunction("identity_async", async value => {
        await new Promise(resolve => setTimeout(resolve, 1));
        assert.equal(value.toInt(), 42);
        return value;
    });
    perl.registerFunction("fresh", () => { returned = perl.createInt(42); return returned; });
    await evaluate('for (1..1000) { die "identity" unless identity(42) == 42; die "fresh" unless fresh() == 42; } die "async identity" unless identity_async(42) == 42;');
    assert.throws(() => borrowed.toInt(), /disposed/);
    assert.throws(() => returned.toInt(), /disposed/);
    await returned.dispose(); // Ownership has transferred; disposal is a no-op.
    assertions += 3;

    perl.registerFunction("bad_dispose", value => { value.dispose(); });
    perl.registerFunction("bad_decref", value => { value.decref(); });
    perl.registerFunction("reject_callback", async value => {
        borrowed = value;
        await Promise.resolve();
        throw new Error("intentional rejection");
    });
    await evaluate('eval { bad_dispose(1) }; die "missing ownership error" unless $@ =~ /borrowed/; eval { bad_decref(1) }; die "missing decref error" unless $@ =~ /borrowed/; eval { reject_callback(1) }; die "missing rejection" unless $@ =~ /intentional rejection/;');
    assert.throws(() => borrowed.toInt(), /disposed/);
    assertions += 3;

    const other = await create();
    const foreign = other.createInt(7);
    try {
        perl.registerFunction("foreign_value", () => foreign);
        await evaluate('eval { foreign_value() }; die "missing interpreter error" unless $@ =~ /another interpreter/;');
        assert.equal(foreign.toInt(), 7);
        assert.throws(() => perl.setVariable("foreign", foreign), /another interpreter/);
        await assert.rejects(perl.call("identity", [foreign]), /another interpreter/);
        const values = perl.createArray([0]);
        const mapping = perl.createHash({key: 0});
        assert.throws(() => values.set(0, foreign), /another interpreter/);
        assert.throws(() => mapping.set("key", foreign), /another interpreter/);
        await values.dispose();
        await mapping.dispose();
        assertions += 5;
    } finally {
        await foreign.dispose();
        await other.dispose();
    }

    let destroyed = 0;
    perl.registerFunction("destroyed", async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        destroyed++;
    });
    await evaluate('package Lifecycle; sub DESTROY { main::destroyed() }; package main; sub new_probe { bless {}, "Lifecycle" }');
    // A newly allocated returned handle must surrender its original reference.
    // If C retains an extra reference, these objects never reach DESTROY.
    perl.registerFunction("fresh_object", value => {
        const target = value.deref();
        const result = target.createRef();
        target.dispose(); // The input and returned reference still own the object.
        return result;
    });
    for (let i = 0; i < 20; i++) {
        await evaluate('our $object = new_probe(); { my $returned = fresh_object($object); undef $object; }');
    }
    assert.equal(destroyed, 20, "fresh callback results leak their owned reference");
    assertions++;

    for (const kind of ["array", "hash", "scalar"]) {
        await evaluate('our @array = (new_probe()); our %hash = (key => new_probe()); our $scalar = new_probe();');
        const array = perl.getArrayVariable("array");
        const hash = perl.getHashVariable("hash");
        const before = destroyed;
        const changed = kind === "array" ? array.set(0, 42)
            : kind === "hash" ? hash.set("key", 42) : perl.setVariable("scalar", 42);
        assert.equal(typeof changed?.then, "function", `${kind} replacement must expose asynchronous destruction`);
        await changed;
        assert.equal(destroyed, before + 1, `${kind} destructor must finish before replacement resolves`);
        await evaluate(`die "replacement failed" unless ${kind === "array" ? "$array[0]" : kind === "hash" ? "$hash{key}" : "$scalar"} == 42;`);
        await evaluate('undef @array; undef %hash; undef $scalar;');
        await array.dispose();
        await hash.dispose();
        assertions += 3;
    }
    const array = perl.createArray([1]);
    const hash = perl.createHash({key: 1});
    assert.equal(array.set(0, 2), undefined);
    assert.equal(hash.set("key", 2), undefined);
    assert.equal(perl.setVariable("plain", 2), undefined);
    await array.dispose();
    await hash.dispose();
    assertions += 3;
    await evaluate('1');
    console.log(`Runtime lifecycle: ${assertions} checks passed (${process.argv[2] ?? "bundled runtime"})`);
} catch (error) {
    failure = error;
    throw error;
} finally {
    try { await perl.dispose(); }
    catch (error) { if (!failure) throw error; }
}
