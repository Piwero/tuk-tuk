import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

for (const path of ["nginx.conf", "../chart/configmap.yaml"]) {
  test(`${path} allows LiveKit connections`, () => {
    const config = readFileSync(new URL(path, import.meta.url), "utf8");
    const policy = config.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];
    assert.ok(policy, "CSP header missing");
    const connect = policy
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src "))
      ?.split(/\s+/);
    assert.ok(connect, "connect-src missing");
    for (const source of ["'self'", "https://*.livekit.cloud", "wss://*.livekit.cloud"]) {
      assert.ok(connect.includes(source), `${source} missing from connect-src`);
    }
  });
}
