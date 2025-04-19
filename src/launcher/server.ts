import { spawn } from "child_process";

export type StartProcessProps = {
  path: string;
  extraEnvs?: Record<string, string>;
  beforeSpawn?: () => Promise<void>;
  onError?: (err: Error) => Promise<void>;
};

export const startProcess = async (props: StartProcessProps) => {
  await props.beforeSpawn?.();

  const serverProcess = spawn("node", [props.path], {
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
