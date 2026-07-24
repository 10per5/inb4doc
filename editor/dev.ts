import { spawn } from "child_process";
import { join } from "path";

const serve = spawn("bun", [join(import.meta.dir, "serve.ts")], {
  cwd: import.meta.dir,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, EDITOR_SELF_BASE: "" },
});

const watch = spawn("bun", [join(import.meta.dir, "build.ts"), "--watch"], {
  cwd: import.meta.dir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    LIVE_URL_BASE: "http://localhost:5000",
    EDITOR_SELF_BASE: "http://localhost:3000",
  },
});

for (const proc of [serve, watch]) {
  proc.on("exit", (code) => {
    serve.kill();
    watch.kill();
    process.exit(code ?? 0);
  });
}

process.on("SIGINT", () => {
  serve.kill();
  watch.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  serve.kill();
  watch.kill();
  process.exit(0);
});
