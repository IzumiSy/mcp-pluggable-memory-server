#!/usr/bin/env node
import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { existsSync, unlinkSync } from "fs";
import { Client } from "undici";
import path from "path";

// 設定
const SOCKET_PATH =
  process.env.SOCKET_PATH ||
  join(homedir(), ".local", "share", "duckdb-memory-server", "db-server.sock");
const MEMORY_FILE_PATH =
  process.env.MEMORY_FILE_PATH ||
  join(
    homedir(),
    ".local",
    "share",
    "duckdb-memory-server",
    "knowledge-graph.data"
  );

// DBサーバーのヘルスチェック
async function checkDbServerHealth(client: Client): Promise<boolean> {
  try {
    // JSON-RPCリクエストを送信
    const { statusCode, body } = await client.request({
      method: "POST",
      path: "/rpc",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "health",
        params: {},
      }),
    });

    // レスポンスの確認
    if (statusCode === 200) {
      const response = (await body.json()) as {
        jsonrpc: string;
        id: number;
        result?: { status: string };
        error?: any;
      };

      if (response.result && response.result.status === "ok") {
        await client.close();
        return true;
      }
    }

    await client.close();
    return false;
  } catch (error) {
    // 接続エラーの場合、サーバーは起動していないと判断
    console.error("Health check error:", error);
    return false;
  }
}

// DBサーバーの起動
function startDbServer(): ChildProcess {
  console.log("Starting DB server...");

  // 既存のソケットファイルを削除（前回の異常終了時に残っている可能性）
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }

  // 環境変数の設定
  const env = {
    ...process.env,
    SOCKET_PATH,
    MEMORY_FILE_PATH,
  };

  // DBサーバーのパス
  const dbServerPath = new URL("./db-server/index.mjs", import.meta.url)
    .pathname;

  // DBサーバーをサブプロセスとして起動
  const dbProcess = spawn("node", [dbServerPath], {
    env,
    stdio: "inherit",
  });

  // エラーハンドリング
  dbProcess.on("error", (err) => {
    console.error("Failed to start DB server:", err);
    process.exit(1);
  });

  return dbProcess;
}

// MCPサーバーの起動
function startMcpServer(): ChildProcess {
  console.log("Starting MCP server...");

  // 環境変数の設定
  const env = {
    ...process.env,
    SOCKET_PATH,
    MEMORY_FILE_PATH,
  };

  // MCPサーバーのパス
  const mcpServerPath = new URL("./index.mjs", import.meta.url).pathname;

  // MCPサーバーをサブプロセスとして起動
  const mcpProcess = spawn("node", [mcpServerPath], {
    env,
    stdio: "inherit",
  });

  // エラーハンドリング
  mcpProcess.on("error", (err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });

  return mcpProcess;
}

// ヘルスチェックを一定間隔でポーリング
async function waitForDbServer(
  client: Client,
  maxAttempts: number = 10,
  interval: number = 500
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isHealthy = await checkDbServerHealth(client);
    if (isHealthy) {
      return true;
    }

    // 次の試行まで待機
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

// メイン関数
async function main() {
  let dbProcess: ChildProcess | null = null;

  if (!existsSync(SOCKET_PATH)) {
    // DBサーバーが起動していない場合は起動
    dbProcess = startDbServer();
  }

  // ソケットに接続してヘルスチェック
  const client = new Client("http://localhost", {
    socketPath: SOCKET_PATH,
    keepAliveTimeout: 1000,
  });

  // DBサーバーのヘルスチェック
  const isDbServerRunning = await checkDbServerHealth(client);

  if (!isDbServerRunning) {
    // DBサーバーが起動していない場合は起動
    dbProcess = startDbServer();

    // DBサーバーの起動を待つ（ポーリング）
    const isStarted = await waitForDbServer(client);
    if (!isStarted) {
      console.error("DB server failed to start after multiple attempts");
      if (dbProcess) {
        dbProcess.kill();
      }
      process.exit(1);
    }

    console.log("DB server started successfully");
  } else {
    console.log("DB server is already running");
  }

  // MCPサーバーを起動
  const mcpProcess = startMcpServer();

  // シグナルハンドリング
  const cleanup = () => {
    console.log("Shutting down...");
    if (dbProcess) {
      dbProcess.kill();
    }
    mcpProcess.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // MCPサーバーが終了したら、DBサーバーも終了（自分で起動した場合のみ）
  mcpProcess.on("exit", (code) => {
    console.log(`MCP server exited with code ${code}`);
    if (dbProcess) {
      dbProcess.kill();
    }
    process.exit(code || 0);
  });
}

// 実行
main().catch((err) => {
  console.error("Launcher error:", err);
  process.exit(1);
});
