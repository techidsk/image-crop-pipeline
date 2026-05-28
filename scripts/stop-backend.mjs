import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || "8000");

const run = async (command, args) => {
  try {
    const result = await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return `${result.stdout || ""}${result.stderr || ""}`;
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || ""}`;
  }
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const windowsPidsForPort = async (port) => {
  const output = await run("netstat", ["-ano"]);
  return unique(
    output
      .split(/\r?\n/)
      .filter((line) => line.includes(`:${port}`) && line.includes("LISTENING"))
      .map((line) => line.trim().split(/\s+/).at(-1))
  );
};

const windowsPythonChildren = async (parentPid) => {
  const output = await run("wmic", [
    "process",
    "where",
    `commandline like '%parent_pid=${parentPid}%'`,
    "get",
    "ProcessId",
    "/format:list",
  ]);
  return unique(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^ProcessId=(\d+)/)?.[1])
  );
};

const stopWindows = async () => {
  const owners = await windowsPidsForPort(BACKEND_PORT);
  if (owners.length === 0) {
    console.log(`[backend] 端口 ${BACKEND_PORT} 没有运行中的监听服务`);
    return;
  }

  const childPids = (
    await Promise.all(owners.map((pid) => windowsPythonChildren(pid)))
  ).flat();
  const pids = unique([...childPids, ...owners]);

  for (const pid of pids) {
    const output = await run("taskkill", ["/PID", pid, "/F"]);
    if (output.includes("SUCCESS")) {
      console.log(`[backend] 已关闭进程 ${pid}`);
    }
  }

  const remaining = await windowsPidsForPort(BACKEND_PORT);
  if (remaining.length > 0) {
    console.log(`[backend] 端口 ${BACKEND_PORT} 仍被占用: ${remaining.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[backend] 端口 ${BACKEND_PORT} 已释放`);
};

const stopPosix = async () => {
  const output = await run("sh", [
    "-c",
    `lsof -ti tcp:${BACKEND_PORT} -sTCP:LISTEN 2>/dev/null || true`,
  ]);
  const pids = unique(output.split(/\s+/));
  if (pids.length === 0) {
    console.log(`[backend] 端口 ${BACKEND_PORT} 没有运行中的监听服务`);
    return;
  }
  for (const pid of pids) {
    await run("kill", ["-TERM", pid]);
    console.log(`[backend] 已请求关闭进程 ${pid}`);
  }
};

if (platform() === "win32") {
  await stopWindows();
} else {
  await stopPosix();
}
