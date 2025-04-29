import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { appRouter } from "./handlers";
import { defaultAppDir, socketFileName } from "../path";
import { join } from "path";

(async () => {
  const server = Fastify();
  server.register(fastifyTRPCPlugin, {
    trpcOptions: {
      router: appRouter,
    },
  });

  await server.listen({ path: join(defaultAppDir, socketFileName) });
})();
