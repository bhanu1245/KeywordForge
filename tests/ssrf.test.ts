import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UnsafeUrlError,
  assertConnectAllowed,
  fetchSiteContext,
  resolvePinnedTarget,
  type LookupFn,
} from "../src/lib/ai/keywordGenerator.ts";

const PUBLIC_IP = "93.184.216.34"; // example.com
const METADATA_IP = "169.254.169.254";

interface RebindingLookup {
  (hostname: string): Promise<Array<{ address: string; family: number }>>;
  calls: number;
}

/**
 * A resolver that answers differently on each call — i.e. DNS rebinding.
 * `calls` is exposed so tests can assert exactly how many lookups happened;
 * anything above one reopens the rebinding window.
 */
function rebindingLookup(answers: string[][]): RebindingLookup {
  const fn: RebindingLookup = Object.assign(
    async (_hostname: string) => {
      const answer = answers[Math.min(fn.calls, answers.length - 1)];
      fn.calls++;
      return answer.map((address) => ({ address, family: 4 }));
    },
    { calls: 0 },
  );
  return fn;
}

describe("assertConnectAllowed", () => {
  it("permits public addresses", () => {
    assert.doesNotThrow(() => assertConnectAllowed(PUBLIC_IP, 4));
    assert.doesNotThrow(() => assertConnectAllowed("8.8.8.8", 4));
    assert.doesNotThrow(() => assertConnectAllowed("2606:2800:220:1:248:1893:25c8:1946", 6));
  });

  it("blocks every private and reserved range", () => {
    const blocked: Array<[string, number]> = [
      ["127.0.0.1", 4],
      ["10.1.2.3", 4],
      ["172.16.0.1", 4],
      ["172.31.255.255", 4],
      ["192.168.1.1", 4],
      [METADATA_IP, 4], // cloud metadata
      ["100.64.0.1", 4], // carrier-grade NAT
      ["0.0.0.0", 4],
      ["224.0.0.1", 4], // multicast
      ["::1", 6],
      ["fe80::1", 6],
      ["fd00::1", 6],
      ["::ffff:10.0.0.1", 6], // IPv4-mapped IPv6
    ];
    for (const [ip, family] of blocked) {
      assert.throws(
        () => assertConnectAllowed(ip, family),
        UnsafeUrlError,
        `${ip} should be blocked`,
      );
    }
  });

  it("blocks 172.16/12 without over-blocking neighbouring 172 space", () => {
    assert.throws(() => assertConnectAllowed("172.20.0.1", 4), UnsafeUrlError);
    assert.doesNotThrow(() => assertConnectAllowed("172.15.0.1", 4));
    assert.doesNotThrow(() => assertConnectAllowed("172.32.0.1", 4));
  });
});

describe("resolvePinnedTarget", () => {
  it("returns the resolved address so the caller can pin to it", async () => {
    const target = await resolvePinnedTarget(
      "https://example.com/about",
      rebindingLookup([[PUBLIC_IP]]),
    );
    assert.equal(target.address, PUBLIC_IP);
    assert.equal(target.url.hostname, "example.com");
  });

  it("resolves EXACTLY ONCE — a second lookup is the rebinding window", async () => {
    const lookup = rebindingLookup([[PUBLIC_IP], [METADATA_IP]]);
    await resolvePinnedTarget("https://rebind.example/", lookup);
    assert.equal(
      lookup.calls,
      1,
      "more than one resolution reopens the DNS rebinding window",
    );
  });

  /**
   * The core rebinding scenario: the attacker's DNS answers with a public IP
   * for the pre-flight check, then a private one for the real connection.
   * Because the target is pinned to the FIRST answer and connected to as a
   * literal, the second answer is never consulted.
   */
  it("pins to the checked address, never re-consulting DNS", async () => {
    const lookup = rebindingLookup([[PUBLIC_IP], [METADATA_IP]]);
    const target = await resolvePinnedTarget("http://rebind.example/", lookup);

    assert.equal(target.address, PUBLIC_IP, "must pin to the address it checked");
    assert.notEqual(target.address, METADATA_IP);

    // Prove the fixture really would have rebound on a second lookup, so this
    // test fails loudly if the pinning is ever removed.
    const second = await lookup("rebind.example");
    assert.equal(second[0].address, METADATA_IP);
  });

  it("rejects when the first answer is already private", async () => {
    await assert.rejects(
      () => resolvePinnedTarget("http://evil.example/", rebindingLookup([[METADATA_IP]])),
      UnsafeUrlError,
    );
  });

  it("rejects a mixed answer set containing any private address", async () => {
    // An attacker may return both, hoping the client picks the private one.
    await assert.rejects(
      () =>
        resolvePinnedTarget(
          "http://mixed.example/",
          rebindingLookup([[PUBLIC_IP, METADATA_IP]]),
        ),
      UnsafeUrlError,
    );
  });

  it("validates a raw IP URL directly, with no DNS involved", async () => {
    const lookup = rebindingLookup([[PUBLIC_IP]]);
    await assert.rejects(
      () => resolvePinnedTarget(`http://${METADATA_IP}/latest/meta-data/`, lookup),
      UnsafeUrlError,
    );
    assert.equal(lookup.calls, 0, "an IP literal must not be resolved at all");
  });

  it("validates a raw IPv6 literal", async () => {
    await assert.rejects(() => resolvePinnedTarget("http://[::1]/"), UnsafeUrlError);
  });

  it("enforces the scheme allow-list", async () => {
    for (const url of ["ftp://example.com/x", "file:///etc/passwd", "gopher://x/"]) {
      await assert.rejects(() => resolvePinnedTarget(url), UnsafeUrlError, url);
    }
  });

  it("blocks localhost-style names before any lookup", async () => {
    const lookup = rebindingLookup([[PUBLIC_IP]]);
    for (const host of ["http://localhost/", "http://foo.localhost/", "http://db.internal/"]) {
      await assert.rejects(() => resolvePinnedTarget(host, lookup), UnsafeUrlError, host);
    }
    assert.equal(lookup.calls, 0);
  });

  it("surfaces resolution failure as a readable error", async () => {
    const failing: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    await assert.rejects(
      () => resolvePinnedTarget("https://nope.invalid/", failing),
      UnsafeUrlError,
    );
  });
});

describe("fetchSiteContext end-to-end guard", () => {
  /**
   * No hostname involved at all — proves the address that gets connected to is
   * checked, not merely a pre-flight hostname lookup.
   */
  it("refuses a raw private IP without opening a connection", async () => {
    for (const url of [
      `http://${METADATA_IP}/latest/meta-data/`,
      "http://127.0.0.1:22/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://[::1]/",
    ]) {
      await assert.rejects(() => fetchSiteContext(url), UnsafeUrlError, url);
    }
  });

  it("refuses a hostname that rebinds to a private address", async () => {
    // First answer private => blocked outright, no connection attempted.
    await assert.rejects(
      () => fetchSiteContext("http://rebind.example/", rebindingLookup([[METADATA_IP]])),
      UnsafeUrlError,
    );
  });
});
