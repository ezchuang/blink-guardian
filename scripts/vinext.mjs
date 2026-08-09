import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const allowedCommands = new Set(["dev", "build", "start"]);

if (!allowedCommands.has(command)) {
  console.error("Usage: node scripts/vinext.mjs <dev|build|start>");
  process.exit(1);
}

const cliPath = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);

const child = spawn(process.execPath, [cliPath, command, ...process.argv.slice(3)], {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH:
      process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
  },
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`vinext stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
