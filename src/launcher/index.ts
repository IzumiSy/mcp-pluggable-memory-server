#!/usr/bin/env node
import { existsSync, unlinkSync } from "fs";
import { Client } from "undici";
import { addPid, removePid } from "./pid";
import { startProcess, SOCKET_PATH } from "./server";

// DBサーバーのヘルスチェック
const checkDBServerHealth = async (client: Client) => {
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

const startDBServer = async () => {
  // DBサーバーをサブプロセスとして起動
  // 既存のソケットファイルを起動前に削除（前回の異常終了時に残っている可能性）
  const start = async () => {
    const process = await startProcess({
      path: "../db-server/index.mjs",
      beforeSpawn: async () => {
        if (existsSync(SOCKET_PATH)) {
          unlinkSync(SOCKET_PATH);
        }
      },
    });

    const kill = async () => {
      process?.kill();
      await removePid(SOCKET_PATH);
    };

    return {
      process,
      kill,
      waitUp: async (client: Client) => {
        const maxAttempts = 10;
        const interval = 500;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const isHealthy = await checkDBServerHealth(client);
          if (isHealthy) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, interval));
        }

        await kill();
      },
    };
  };

  if (!existsSync(SOCKET_PATH)) {
    return start();
  }

  const client = new Client("http://localhost", {
    socketPath: SOCKET_PATH,
    keepAliveTimeout: 1000,
  });

  // DBサーバーのヘルスチェック
  const isDBServerHealthy = await checkDBServerHealth(client);
  if (!isDBServerHealthy) {
    const server = await start();
    await server.waitUp(client);
    return server;
  }

  return null;
};

(async () => {
  try {
    await addPid();

    const dbProcess = await startDBServer();
    const mcpProcess = await startProcess({
      path: "../client/index.mjs",
    });

    mcpProcess.on("exit", async () => {
      // DBサーバーのプロセスが保持されている場合のみ終了
      await dbProcess?.kill();
    });

    const cleanup = () => {
      mcpProcess.kill();
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch {
    await removePid(SOCKET_PATH);
  }
})();
