#!/usr/bin/env node
import { existsSync, unlinkSync } from "fs";
import { addPid, removePid } from "./pid";
import { startProcess, SOCKET_PATH } from "./server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { defaultSocketPath } from "../client";
import { AppRouter } from "../db-server/handlers";

const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: process.env.SOCKET_PATH ?? defaultSocketPath,
    }),
  ],
});

const checkDBServerHealth = async () => {
  try {
    const r = await client.healthcheck.query();
    return r === "ok";
  } catch (error) {
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
      waitUp: async () => {
        const maxAttempts = 10;
        const interval = 500;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const isHealthy = await checkDBServerHealth();
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

  // DBサーバーのヘルスチェック
  const isDBServerHealthy = await checkDBServerHealth();
  if (!isDBServerHealthy) {
    const server = await start();
    await server.waitUp();
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
