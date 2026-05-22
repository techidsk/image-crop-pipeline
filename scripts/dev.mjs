import { spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const BACKEND_PORT = 8000;

const isPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

const venvPython = () => {
  const win = path.join(root, ".venv", "Scripts", "python.exe");
  const posix = path.join(root, ".venv", "bin", "python");
  if (existsSync(win)) return win;
  if (existsSync(posix)) return posix;
  return process.platform === "win32" ? "python" : "python3";
};

const children = [];

const startProcess = (label, command, args) => {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false });
  child.on("error", (err) => console.error(`[${label}] 启动失败:`, err.message));
  child.on("exit", (code) => {
    console.log(`[${label}] 已退出 (code ${code})`);
    shutdown();
  });
  children.push(child);
  return child;
};

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const main = async () => {
  if (await isPortOpen(BACKEND_PORT)) {
    console.log(`[backend] 端口 ${BACKEND_PORT} 已在运行，跳过启动`);
  } else {
    console.log(`[backend] 启动 uvicorn (端口 ${BACKEND_PORT})`);
    startProcess("backend", venvPython(), [
      "-m",
      "uvicorn",
      "backend.app.main:app",
      "--reload",
      "--port",
      String(BACKEND_PORT)
    ]);
  }

  const bun = process.execPath;
  startProcess("frontend", bun, ["x", "vite", "--host", "127.0.0.1"]);
};

main();
