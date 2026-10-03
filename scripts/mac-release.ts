// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A signed, notarized macOS build from any OS (ADR 0019): electron-builder packages the app unsigned,
// rcodesign (apple-codesign, Apache-2.0/MPL) signs every bundle with the Developer ID under the hardened
// runtime, Apple's notary service checks it, the ticket is stapled, and a zip that keeps the bundle's
// symlinks is written. Credentials stay outside the repo, in GHOSTHAND_SIGNING_DIR (default
// ~/.config/ghosthand/signing): developer-id.key + developer-id.pem (the Developer ID Application
// certificate) and notary-api-key.json (`rcodesign encode-app-store-connect-api-key`).
//
//   node scripts/mac-release.ts [--version 0.0.18] [--arch arm64|x64] [--skip-build] [--no-notarize]
import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const desktop = join(root, "apps/desktop");
const signing = process.env.GHOSTHAND_SIGNING_DIR ?? join(homedir(), ".config/ghosthand/signing");
const rcodesign = process.env.RCODESIGN ?? "rcodesign";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const arch = option("--arch") ?? "arm64";
const version =
  option("--version") ??
  (JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { version: string }).version;

const need = (file: string): string => {
  const path = join(signing, file);
  if (!existsSync(path)) throw new Error(`missing ${path} (see ADR 0019 for how to create it)`);
  return path;
};
const run = (cmd: string, argv: string[], cwd = root): void => {
  console.log(`$ ${cmd} ${argv.join(" ")}`);
  execFileSync(cmd, argv, { cwd, stdio: "inherit" });
};

const key = need("developer-id.key");
const cert = need("developer-id.pem");
// Electron needs JIT and unsigned executable memory for V8 under the hardened runtime.
const entitlements = join(desktop, "build/entitlements.mac.plist");

if (!flag("--skip-build")) {
  rmSync(join(desktop, "release"), { recursive: true, force: true });
  run("npx", ["electron-vite", "build"], desktop);
  run(
    "npx",
    [
      "electron-builder",
      "--config",
      "electron-builder.yml",
      "--mac",
      "zip",
      `--${arch}`,
      "--publish",
      "never",
      // Unsigned here: electron-builder can only sign on macOS; rcodesign signs below on any OS.
      "-c.mac.identity=null",
      `-c.extraMetadata.version=${version}`,
    ],
    desktop,
  );
}

const outDir = join(desktop, "release", arch === "arm64" ? "mac-arm64" : "mac");
const built = join(outDir, "ghosthand.app");
const app = join(outDir, "GhostHand.app");
if (existsSync(built)) renameSync(built, app);
if (!existsSync(app)) throw new Error(`no app bundle at ${app}`);

// Apple's time-stamp server resolves to IPv6 first; hosts without an IPv6 route fail there, so the
// IPv4 address is used directly (plain HTTP, no certificate name to match).
const tsa = await lookup("timestamp.apple.com", { family: 4 }).then(
  (a) => `http://${a.address}/ts01`,
  () => "http://timestamp.apple.com/ts01",
);
const helpers = [
  "GhostHand Helper",
  "GhostHand Helper (GPU)",
  "GhostHand Helper (Plugin)",
  "GhostHand Helper (Renderer)",
];
run(rcodesign, [
  "sign",
  "--pem-file",
  key,
  "--pem-file",
  cert,
  "--for-notarization",
  "--timestamp-url",
  tsa,
  "-e",
  entitlements,
  ...helpers.flatMap((h) => ["-e", `Contents/Frameworks/${h}.app:${entitlements}`]),
  app,
]);

if (!flag("--no-notarize")) {
  const apiKey = need("notary-api-key.json");
  // rcodesign uploads; the verdict is polled here with fetch, which falls back to IPv4 when a host's IPv6
  // route is broken (rcodesign's own polling failed on such a host). A first submission can take hours.
  console.log(`$ ${rcodesign} notary-submit --api-key-file ${apiKey} ${app}`);
  const out = execFileSync(rcodesign, ["notary-submit", "--api-key-file", apiKey, app], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const id = /created submission ID: ([0-9a-f-]{36})/.exec(out)?.[1];
  if (!id) throw new Error(`no submission id in rcodesign output:\n${out}`);
  const status = await waitForNotary(apiKey, id);
  if (status !== "Accepted")
    throw new Error(`notarization ${status}: run \`${rcodesign} notary-log --api-key-file ${apiKey} ${id}\``);
  run(rcodesign, ["staple", app]);
}

/** Polls the notary service until the submission leaves "In Progress"; returns the final status. */
async function waitForNotary(apiKeyFile: string, id: string): Promise<string> {
  const key = JSON.parse(readFileSync(apiKeyFile, "utf8")) as {
    issuer_id: string;
    key_id: string;
    private_key: string;
  };
  const pem = `-----BEGIN PRIVATE KEY-----\n${key.private_key}\n-----END PRIVATE KEY-----\n`;
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const token = (): string => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: "ES256", kid: key.key_id, typ: "JWT" })}.${b64({ iss: key.issuer_id, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" })}`;
    const sig = sign("sha256", Buffer.from(unsigned), {
      key: createPrivateKey(pem),
      dsaEncoding: "ieee-p1363",
    });
    return `${unsigned}.${sig.toString("base64url")}`;
  };
  const started = Date.now();
  for (;;) {
    let status = "?";
    try {
      const res = await fetch(`https://appstoreconnect.apple.com/notary/v2/submissions/${id}`, {
        headers: { authorization: `Bearer ${token()}` },
      });
      const body = (await res.json()) as { data?: { attributes?: { status?: string } } };
      status = body.data?.attributes?.status ?? `HTTP ${res.status}`;
    } catch (e) {
      status = `network: ${e instanceof Error ? e.message : String(e)}`;
    }
    console.log(`notary ${id}: ${status} (${Math.round((Date.now() - started) / 1000)} s)`);
    if (status === "Accepted" || status === "Invalid" || status === "Rejected") return status;
    if (Date.now() - started > 4 * 3600_000) return "still In Progress after 4 h";
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

// A zip that keeps the framework symlinks and executable bits (`ditto` is macOS-only).
const zip = join(desktop, "release", `GhostHand-${version}-${arch}-mac.zip`);
rmSync(zip, { force: true });
run("python3", [
  "-c",
  [
    "import os,stat,sys,zipfile",
    "app,out=sys.argv[1],sys.argv[2]",
    "base=os.path.dirname(app)",
    "z=zipfile.ZipFile(out,'w')",
    "for r,ds,ns in os.walk(app,followlinks=False):",
    "  for d in list(ds):",
    "    p=os.path.join(r,d)",
    "    if os.path.islink(p): ds.remove(d); ns.append(d)",
    "    else: zi=zipfile.ZipInfo(os.path.relpath(p,base)+'/'); zi.create_system=3; zi.external_attr=(stat.S_IFDIR|0o755)<<16|0x10; z.writestr(zi,'')",
    "  for n in ns:",
    "    p=os.path.join(r,n); st=os.lstat(p); zi=zipfile.ZipInfo(os.path.relpath(p,base)); zi.create_system=3",
    "    if stat.S_ISLNK(st.st_mode): zi.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(zi,os.readlink(p))",
    "    else: zi.external_attr=(stat.S_IFREG|stat.S_IMODE(st.st_mode))<<16; zi.compress_type=zipfile.ZIP_DEFLATED; z.writestr(zi,open(p,'rb').read(),compresslevel=6)",
    "z.close()",
  ].join("\n"),
  app,
  zip,
]);
console.log(`\n${zip}`);
