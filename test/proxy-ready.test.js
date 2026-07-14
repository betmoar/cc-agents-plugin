import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deterministic gate for hooks/proxy-ready.sh. Regression guard for the macOS
// portability bug where the probe used `timeout` (absent on macOS) and so
// always reported the proxy down — the structural tests stayed green because
// they only assert the SKILLS mention the script, never run it.
//
// The probe must run ASYNC: the in-process HTTP server below shares this event
// loop, so a synchronous execFileSync would block the loop and starve the very
// connection the probe is trying to make. execFile (async) keeps the loop free.

function runProbe(port) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["hooks/proxy-ready.sh"],
      { env: { ...process.env, PROXY_PORT: String(port) } },
      (err) => resolve(err ? err.code : 0),
    );
  });
}

describe("proxy-ready.sh", () => {
  let server;
  let livePort;

  before(async () => {
    // Stand-in proxy: 200 only for GET /v1/models (the readiness route).
    server = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "glm-5.2" }], _errors: [] }));
      } else {
        res.writeHead(404);
        res.end("nope");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    livePort = server.address().port;
  });

  after(() => server.close());

  it("exits 0 when GET /v1/models returns 200 (proxy up)", async () => {
    assert.equal(await runProbe(livePort), 0);
  });

  it("exits 1 with no listener (proxy down)", async () => {
    // Port 1 is privileged and not listening in CI/dev → connection refused.
    assert.equal(await runProbe(1), 1);
  });

  it("exits 1 when /v1/models does not return 200 (proxy up but route unhealthy)", async () => {
    const bad = createServer((_req, res) => { res.writeHead(500); res.end("x"); });
    await new Promise((r) => bad.listen(0, "127.0.0.1", r));
    const port = bad.address().port;
    try {
      assert.equal(await runProbe(port), 1);
    } finally {
      bad.close();
    }
  });

  // FAIL-CLOSED drift-lock: with curl absent, `curl` exits 127 (command not
  // found) — neither 7 nor 28 — and the old probe reported the proxy UP on a
  // system that cannot probe at all. It must fail closed instead.
  it("exits 1 when curl is not on PATH (fail closed, not open)", async () => {
    const fakebin = mkdtempSync(join(tmpdir(), "ccagents-nocurl-"));
    try {
      const bashPath = execFileSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
      symlinkSync(bashPath, join(fakebin, "bash"));
      const code = await new Promise((resolve) => {
        execFile(
          "bash",
          ["hooks/proxy-ready.sh"],
          { env: { PATH: fakebin, PROXY_PORT: String(livePort) } },
          (err) => resolve(err ? err.code : 0),
        );
      });
      // Proxy is genuinely UP (livePort), but with no curl we must still say no.
      assert.equal(code, 1);
    } finally {
      rmSync(fakebin, { recursive: true, force: true });
    }
  });
});
