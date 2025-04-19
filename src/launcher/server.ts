import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

export type StartProcessProps = {
  path: string;
  extraEnvs?: Record<string, string>;
  beforeSpawn?: () => Promise<void>;
  onError?: (err: Error) => Promise<void>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

export const startProcess = async (props: StartProcessProps) => {
  await props.beforeSpawn?.();

  const serverProcess = spawn("node", [resolve(__dirname, props.path)], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...props.extraEnvs,
    },
  });

  serverProcess.on("error", async (err) => {
    await props.onError?.(err);
    process.exit(1);
  });

  return serverProcess;
};
