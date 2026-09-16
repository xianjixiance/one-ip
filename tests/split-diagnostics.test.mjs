import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeIp } from "../src/lib/ip-address.ts";
import { createRequestScheduler } from "../src/lib/request-scheduler.ts";
import {
  compareAddresses,
  compareSnapshot,
  createSnapshot,
  matchExpectation,
  parseExpectations,
  parseSnapshot,
  probeTarget,
  validateExpectation,
} from "../src/views/home/split-model.ts";
import { probeSite } from "../src/views/home/split-probe.ts";

const site = {
  name: "Example",
  method: "cftrace",
  domain: "example.com",
  type: "international",
  icon: "",
};
const row = (ip, overrides = {}) => ({
  ...site,
  id: site.name,
  target: probeTarget(site),
  pending: false,
  visible: true,
  geoPending: false,
  geo: ip ? { ip, country_code: "JP" } : undefined,
  result: {
    status: ip ? "success" : "network-error",
    checkedAt: 100,
    durationMs: 10,
  },
  ...overrides,
});

test("IP comparison rejects malformed literals and canonicalizes equivalent IPv6 addresses", () => {
  for (const input of [
    "999.1.1.1",
    "127.1",
    "1.2.3",
    "010.0.0.1",
    "example.com",
    "1.2.3.4/path",
    "::ffff:garbage",
    "1.1.1.1:443",
    "1.1.1.1@host",
    "2001:db8::1%eth0",
  ])
    assert.equal(normalizeIp(input), undefined, input);
  assert.equal(normalizeIp("2001:DB8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(compareAddresses("2001:db8::1", "2001:db8:0:0:0:0:0:1"), "same");
  assert.equal(
    compareAddresses("192.0.2.1", "2001:db8::1"),
    "different-family",
  );
  assert.equal(compareAddresses(undefined, "192.0.2.1"), "unknown");
});

test("baseline distinguishes changed exits, recovery, missing evidence and changed probe targets", () => {
  const baseline = createSnapshot([row("192.0.2.1")], 200);
  assert.equal(compareSnapshot(row("192.0.2.1"), baseline), "same");
  assert.equal(compareSnapshot(row("192.0.2.2"), baseline), "changed");
  assert.equal(compareSnapshot(row(undefined), baseline), "lost");
  assert.equal(
    compareSnapshot(row("192.0.2.1", { pending: true }), baseline),
    "pending",
  );
  assert.equal(
    compareSnapshot(
      row("192.0.2.1", { target: "https://other.example/cdn-cgi/trace" }),
      baseline,
    ),
    "new",
  );
  const failed = createSnapshot([row(undefined)]);
  assert.equal(compareSnapshot(row("192.0.2.1"), failed), "recovered");
  assert.equal(compareSnapshot(row(undefined), failed), "unavailable");
  assert.equal(
    compareSnapshot(row(undefined, { method: "unsupported" }), baseline),
    "unsupported",
  );
  assert.equal(compareSnapshot(row("192.0.2.1"), null), "none");
  const v6 = createSnapshot([row("2001:db8::1")]);
  assert.equal(compareSnapshot(row("2001:db8:0:0:0:0:0:1"), v6), "same");
});

test("saved baseline is immutable and untrusted stored data is validated", () => {
  const live = row("192.0.2.1");
  const snapshot = createSnapshot([live], 200);
  live.geo.ip = "192.0.2.9";
  assert.equal(snapshot.entries.Example.ip, "192.0.2.1");
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), snapshot);
  for (const input of [
    "broken",
    "null",
    JSON.stringify({ ...snapshot, version: 2 }),
    JSON.stringify({
      ...snapshot,
      entries: { Example: { ...snapshot.entries.Example, ip: "not-an-ip" } },
    }),
  ])
    assert.equal(parseSnapshot(input), null);
  assert.equal(
    Object.keys(createSnapshot([row("192.0.2.1", { pending: true })]).entries)
      .length,
    0,
  );
});

test("expected exits keep missing data unknown and support exact IP or region rules", () => {
  const country = validateExpectation("country", " jp ");
  assert.deepEqual(country, { kind: "country", value: "JP" });
  assert.equal(matchExpectation(row("192.0.2.1"), country), "match");
  assert.equal(
    matchExpectation(row("192.0.2.1"), { kind: "country", value: "SG" }),
    "mismatch",
  );
  assert.equal(
    matchExpectation(row("192.0.2.1", { geo: { ip: "192.0.2.1" } }), country),
    "unknown",
  );
  assert.equal(matchExpectation(row(undefined), country), "unknown");
  assert.equal(
    matchExpectation(row("192.0.2.1", { pending: true }), country),
    "unknown",
  );
  assert.equal(
    matchExpectation(
      row("2001:db8::1"),
      validateExpectation("ip", "2001:db8:0:0:0:0:0:1"),
    ),
    "match",
  );
  assert.equal(validateExpectation("ip", "999.1.1.1"), null);
  assert.equal(validateExpectation("country", "ZZ"), null);
  assert.deepEqual(
    parseExpectations(
      '{"ok":{"kind":"country","value":"sg"},"bad":{"kind":"ip","value":"invalid"}}',
    ),
    { ok: { kind: "country", value: "SG" } },
  );
});

test("scheduler bounds concurrency and cancels queued work without starting it", async () => {
  const schedule = createRequestScheduler(2);
  const signal = new AbortController().signal;
  const aborted = new AbortController();
  let active = 0,
    max = 0;
  const releases = [],
    started = [];
  const task = (id) =>
    schedule(async () => {
      started.push(id);
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => releases.push(resolve));
      active--;
      return id;
    }, signal);
  const a = task("a"),
    b = task("b");
  const cancelled = schedule(async () => {
    throw new Error("cancelled task must never start");
  }, aborted.signal);
  const rejection = assert.rejects(cancelled, { name: "AbortError" });
  const c = task("c");
  aborted.abort();
  await rejection;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"]);
  releases.shift()();
  await a;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b", "c"]);
  releases.splice(0).forEach((resolve) => resolve());
  await Promise.all([b, c]);
  assert.equal(max, 2);
  assert.equal(await schedule(async () => "reusable", signal), "reusable");
});

test("scheduler releases slots after failures and rejects already-aborted work", async () => {
  const schedule = createRequestScheduler(1);
  const controller = new AbortController();
  await assert.rejects(
    schedule(async () => {
      throw new Error("failed");
    }, controller.signal),
    /failed/,
  );
  assert.equal(await schedule(async () => 1, controller.signal), 1);
  controller.abort();
  await assert.rejects(
    schedule(async () => {
      throw new Error("should not run");
    }, controller.signal),
    { name: "AbortError" },
  );
});

test("browser probes retain the actual target, omit credentials and refuse redirects", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://gateway.discord.gg/cdn-cgi/trace");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      return new Response("ip=2001:DB8:0:0:0:0:0:1\nloc=JP\ncolo=NRT");
    };
    const target = {
      ...site,
      name: "discord.com",
      domain: "gateway.discord.gg",
    };
    assert.equal(
      probeTarget(target),
      "https://gateway.discord.gg/cdn-cgi/trace",
    );
    const result = await probeSite(target, new AbortController().signal);
    assert.equal(result.status, "success");
    assert.equal(result.geo.ip, "2001:db8::1");
    assert.equal(result.geo.country_code, "JP");
    assert.ok(result.checkedAt > 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("unsupported probes make no request and failures retain honest classifications", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("unexpected request");
    };
    assert.equal(
      (
        await probeSite(
          { ...site, method: "unsupported" },
          new AbortController().signal,
        )
      ).status,
      "unsupported",
    );
    for (const [make, expected] of [
      [() => new Response("denied", { status: 403 }), "http-error"],
      [() => new Response("<html>not a trace</html>"), "unreadable"],
      [() => new Response("ip=999.1.1.1"), "unreadable"],
      [
        () => {
          throw new TypeError("Failed to fetch");
        },
        "network-error",
      ],
      [
        () => {
          throw new DOMException("timed out", "TimeoutError");
        },
        "timeout",
      ],
    ]) {
      globalThis.fetch = async () => make();
      const result = await probeSite(site, new AbortController().signal);
      assert.equal(result.status, expected);
      if (expected === "http-error") assert.equal(result.httpStatus, 403);
      assert.equal(result.geo, undefined);
    }
    globalThis.fetch = async () => Response.json(null);
    assert.equal(
      (
        await probeSite(
          { ...site, method: "ip-json", url: "https://example.com/ip" },
          new AbortController().signal,
        )
      ).status,
      "unreadable",
    );
    const controller = new AbortController();
    globalThis.fetch = async () => {
      controller.abort();
      throw controller.signal.reason;
    };
    await assert.rejects(probeSite(site, controller.signal), {
      name: "AbortError",
    });
  } finally {
    globalThis.fetch = original;
  }
});
