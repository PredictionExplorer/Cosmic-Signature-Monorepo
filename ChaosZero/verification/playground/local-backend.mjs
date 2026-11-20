// The pinned external API exposes HTTP_PORT but always binds it on all interfaces.
// A Go overlay changes just that listener in the disposable local binary.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [backend, runDir] = process.argv.slice(2);
const upstream = join(backend, "cmd/apiserver/main.go");
const original = readFileSync(upstream, "utf8");
const listener = 'Listen(ctx, "tcp", ":"+cfg.HTTPPort)';
if (original.split(listener).length !== 2)
  throw new Error(
    "Cannot isolate the API listener. Use the backend revision from harness.lock.json.",
  );
const local = join(runDir, "local-apiserver.go");
writeFileSync(
  local,
  original.replace(listener, 'Listen(ctx, "tcp", net.JoinHostPort("127.0.0.1", cfg.HTTPPort))'),
);
writeFileSync(
  join(runDir, "backend-overlay.json"),
  JSON.stringify({ Replace: { [upstream]: local } }),
);
