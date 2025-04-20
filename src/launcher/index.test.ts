import { afterEach, describe, expect, test, vi, assert } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createTRPCClient } from "@trpc/client";
import { AppRouter } from "../db-server/handlers";
import { unixDomainSocketLink } from "../client/link";

// 定数定義
const defaultAppDir = join(
  homedir(),
  ".local",
  "share",
  "duckdb-memory-server"
);
const socketFileName = "db-server.sock";
const pidListFileName = ".mcp_servers.json";
const socketFilePath = join(defaultAppDir, socketFileName);
const pidListFilePath = join(defaultAppDir, pidListFileName);

/**
 * DB サーバーのヘルスチェックを実行する関数
 */
async function checkDBServerHealth(): Promise<boolean> {
  try {
    const healthCheckClient = createTRPCClient<AppRouter>({
      links: [
        unixDomainSocketLink({
          path: socketFilePath,
        }),
      ],
    });

    const result = await healthCheckClient.healthcheck.query();
    return result === "ok";
  } catch (error) {
    console.error("Health check failed:", error);
    return false;
  }
}

const checkIfSocketExists = () => {
  if (!existsSync(socketFilePath)) {
    throw new Error("Socket file does not exist");
  }
};

const checkIfDBServerIsRunning = (message?: string) => async () => {
  const isHealthy = await checkDBServerHealth();
  if (!isHealthy) {
    throw new Error(`Server is not healthy: ${message ?? null}`);
  }
};

const getProcessEventHandler = (targetProcess: ChildProcess) => {
  const exitTime: Array<number> = [];

  targetProcess.on("exit", () => {
    exitTime.push(Date.now());
  });

  return {
    waitOnExit: () => {
      if (exitTime.length === 0) {
        throw new Error("Process is still running");
      }
    },
  };
};

const newPID = (pid: number) => () => {
  const r = JSON.parse(readFileSync(pidListFilePath, "utf8")) as {
    pids: number[];
  };

  if (r.pids.includes(pid)) {
    return r.pids;
  }

  throw new Error("PID not found");
};

const getPIDList = () => {
  const r = JSON.parse(readFileSync(pidListFilePath, "utf8")) as {
    pids: number[];
  };

  return r.pids;
};

describe("CLI Launcher E2E Tests", () => {
  test("should start processes, create necessary files, and clean up pids", async () => {
    const launcherProcess = spawn("node", ["dist/launcher/index.mjs"]);
    const processHandler = getProcessEventHandler(launcherProcess);

    await vi.waitFor(checkIfSocketExists);
    await vi.waitFor(checkIfDBServerIsRunning("launcher"));

    const pidsBefore = getPIDList();
    expect(pidsBefore.length).equals(1);

    launcherProcess.kill("SIGINT");

    await vi.waitFor(processHandler.waitOnExit);

    const pidsAfter = getPIDList();
    expect(pidsAfter.length).equals(0);
  });

  test("should handle multiple instances correctly", async () => {
    const launcher1 = spawn("node", ["dist/launcher/index.mjs"]);
    assert(launcher1.pid, "Launcher 1 PID should be defined");

    await vi.waitFor(checkIfSocketExists);
    await vi.waitFor(checkIfDBServerIsRunning("launcher1"));

    // PIDファイルの内容を確認
    const pidsWithLaucncher1 = await vi.waitFor(newPID(launcher1.pid));
    expect(pidsWithLaucncher1.length).toBe(1);

    // 2つ目のインスタンスを起動
    const launcher2 = spawn("node", ["dist/launcher/index.mjs"]);
    assert(launcher2.pid, "Launcher 2 PID should be defined");

    // PIDファイルに両方のプロセスが記録されていることを確認
    const pidsWithLauncher2 = await vi.waitFor(newPID(launcher2.pid));
    expect(pidsWithLauncher2.length).toBe(2);

    await vi.waitFor(checkIfDBServerIsRunning("launcher2"));

    // 最初のインスタンスを終了
    const launcher1ProcessHandler = getProcessEventHandler(launcher1);
    launcher1.kill("SIGINT");
    await vi.waitFor(launcher1ProcessHandler.waitOnExit);

    expect(existsSync(socketFilePath)).toBe(true);

    // PIDファイルから1つのプロセスが削除されたことを確認
    const pidsAfter = getPIDList();
    expect(pidsWithLauncher2).contains(launcher2.pid);
    expect(pidsAfter.length).toBe(1);

    // ヘルスチェックを実行して、サーバーがまだ応答することを確認
    await vi.waitFor(checkIfDBServerIsRunning("launcher1 again"));

    // 2つ目のインスタンスを終了
    const launcher2ProcessHandler = getProcessEventHandler(launcher2);
    launcher2.kill("SIGINT");
    await vi.waitFor(launcher2ProcessHandler.waitOnExit);

    // すべてのプロセスが終了した後、ソケットファイルが削除されたことを確認
    expect(existsSync(socketFilePath)).toBe(false);

    // PIDファイルが空になったことを確認
    const lastPids = getPIDList();
    expect(lastPids).toBe(0);
  });
});
