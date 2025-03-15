#!/usr/bin/env node
import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { existsSync, unlinkSync } from "fs";
import { Client } from "undici";
import { addPid, removePid } from "./pid";

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

// ソケットファイルの削除を行う共通関数（起動時用）
const cleanupSocketFile = () => {
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
};

// DBサーバーのヘルスチェック
const checkDbServerHealth = async (client: Client) => {
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
    return false;
  }
};

// DBサーバーの起動
const startDbServer = () => {
  // 既存のソケットファイルを削除（前回の異常終了時に残っている可能性）
  cleanupSocketFile();

  // 環境変数の設定
  const env = {
    ...process.env,
    SOCKET_PATH,
    MEMORY_FILE_PATH,
  };

  // DBサーバーのパス
  const dbServerPath = new URL("../db-server/index.mjs", import.meta.url)
    .pathname;

  // DBサーバーをサブプロセスとして起動
  const dbProcess = spawn("node", [dbServerPath], {
    env,
    stdio: "inherit",
  });

  // エラーハンドリング
  dbProcess.on("error", async (err) => {
    await removePid(SOCKET_PATH);
    process.exit(1);
  });

  return dbProcess;
};

// MCPサーバーの起動
const startMcpServer = () => {
  const env = {
    ...process.env,
    SOCKET_PATH,
    MEMORY_FILE_PATH,
  };

  // MCPサーバーのパス
  const mcpServerPath = new URL("../index.mjs", import.meta.url).pathname;

  // MCPサーバーをサブプロセスとして起動
  const mcpProcess = spawn("node", [mcpServerPath], {
    env,
    stdio: "inherit",
  });

  // エラーハンドリング
  mcpProcess.on("error", async (err) => {
    await removePid(SOCKET_PATH);
    process.exit(1);
  });

  return mcpProcess;
};

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
const main = async () => {
  // 起動時にPIDを追加
  await addPid();
  let dbProcess: ChildProcess | null = null;

  if (!existsSync(SOCKET_PATH)) {
    // DBサーバーが起動していない場合は起動
    dbProcess = startDbServer();
  }

  // ヘルスチェックのためソケットに接続
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
      if (dbProcess) {
        dbProcess.kill();
      }

      // DBサーバー起動失敗時もPIDリストから自身を削除
      await removePid(SOCKET_PATH);

      process.exit(1);
    }
  }

  // MCPサーバーを起動
  const mcpProcess = startMcpServer();

  // シグナルハンドリング
  const cleanup = async () => {
    if (dbProcess) {
      dbProcess.kill();
    }

    mcpProcess.kill();

    await removePid(SOCKET_PATH);
    process.exit(0);
  };

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  // MCPサーバーが終了したら、DBサーバーも終了（自分で起動した場合のみ）
  mcpProcess.on("exit", async (code) => {
    if (dbProcess) {
      dbProcess.kill();
    }

    await removePid(SOCKET_PATH);
    process.exit(code || 0);
  });
};

// 実行
main().catch(async (err) => {
  await removePid(SOCKET_PATH);
  process.exit(1);
});
