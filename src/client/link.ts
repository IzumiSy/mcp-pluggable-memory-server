import { httpLink } from "@trpc/client";
import { Client, Dispatcher } from "undici";

// A custom httpLink for UNIX domain sockets
export const unixDomainSocketLink = (props: { path: string }) =>
  httpLink({
    url: `unix://${props.path}:/`,
    fetch: async (input, options) => {
      if (typeof input !== "string") {
        throw new Error("Input must be a string or URL");
      }

      if (!input.startsWith("unix:")) {
        throw new Error("URL must start with 'unix:'");
      }

      const matches = input.match(/unix:\/\/([^:]+):(.*)/);
      if (!matches) {
        throw new Error("Invalid UNIX socket URL format");
      }

      const [, socketPath, path] = matches;
      const client = new Client("http://localhost", {
        socketPath,
      });

      const response = await client.request({
        path,
        method: options?.method || "GET",
        headers: options?.headers,
        body: options?.body as Dispatcher.DispatchOptions["body"],
      });

      return {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        headers: response.headers,
        json: async () => response.body.json(),
        text: async () => response.body.text(),
      };
    },
  });
