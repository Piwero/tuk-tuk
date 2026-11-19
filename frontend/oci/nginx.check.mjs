import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const FONT_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

function directive(policy, name) {
  return policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
    ?.split(/\s+/);
}

for (const path of ["nginx.conf", "../chart/configmap.yaml"]) {
  const config = read(path);
  const policy = config.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];

  test(`${path} allows LiveKit connections`, () => {
    assert.ok(policy, "CSP header missing");
    const connect = directive(policy, "connect-src");
    assert.ok(connect, "connect-src missing");
    for (const source of ["'self'", "https://*.livekit.cloud", "wss://*.livekit.cloud"]) {
      assert.ok(connect.includes(source), `${source} missing from connect-src`);
    }
  });

  test(`${path} serves fonts from the instance only`, () => {
    assert.doesNotMatch(policy, FONT_HOSTS);
    assert.deepEqual(directive(policy, "font-src"), ["font-src", "'self'"]);
  });

  test(`${path} caches font files`, () => {
    const block = config.match(/location ~\* \\\.woff2\$ \{([^}]+)\}/)?.[1];
    assert.ok(block, "woff2 location missing");
    assert.match(block, /expires 1y;/);
    assert.match(block, /try_files \$uri =404;/);
  });
}

test("index.html requests no external font host", () => {
  assert.doesNotMatch(read("index.html"), FONT_HOSTS);
});

test("fonts.css declares each face from a bundled file", () => {
  const css = read("src/fonts.css");
  const bundled = new Set(readdirSync(new URL("src/fonts/", import.meta.url)));
  for (const family of ["Bricolage Grotesque", "Instrument Sans", "JetBrains Mono"]) {
    assert.match(css, new RegExp(`font-family: "${family}"`), `${family} missing`);
  }
  const urls = [...css.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 0, "no font urls");
  for (const file of urls) assert.ok(bundled.has(file), `${file} not in src/fonts/`);
  assert.doesNotMatch(css, /url\((?!"\.\/fonts\/)/, "font url outside src/fonts/");
});
