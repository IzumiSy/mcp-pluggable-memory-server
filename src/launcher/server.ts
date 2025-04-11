import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { removePid } from "./pid";
import { defaultSocketPath } from "../client/client";

export const SOCKET_PATH = process.env.SOCKET_PATH || defaultSocketPath;

export const startProcess = async (props: {
  path: string;
  beforeSpawn?: () => Promise<void>;
  onError?: (err: Error) => Promise<void>;
}) => {
  const MEMORY_FILE_PATH =
    process.env.MEMORY_FILE_PATH ||
    join(
      homedir(),
      ".local",
      "share",
      "duckdb-memory-server",
      "knowledge-graph.data"
    );

  await props.beforeSpawn?.();

  const serverProcess = spawn("node", [props.path], {
    stdio: "inherit",
    env: {
      ...process.env,
      SOCKET_PATH,
      MEMORY_FILE_PATH,
    },
  });

  serverProcess.on("error", async (err) => {
    await props.onError?.(err);
    await removePid(SOCKET_PATH);
    process.exit(1);
  });

  return serverProcess;
};
