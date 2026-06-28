import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";

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
    // A real HTTP server standing in for the proxy — any HTTP response counts
    // as "up", so a bare 200 is enough.
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    livePort = server.address().port;
  });

  after(() => server.close());

  it("exits 0 when something is listening (proxy up)", async () => {
    assert.equal(await runProbe(livePort), 0);
  });

  it("exits 1 with no listener (proxy down)", async () => {
    // Port 1 is privileged and not listening in CI/dev → connection refused.
    assert.equal(await runProbe(1), 1);
  });
});
