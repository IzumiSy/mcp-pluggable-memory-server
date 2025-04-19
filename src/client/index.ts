#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EntityObject, ObservationObject, RelationObject } from "../schema";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { AppRouter } from "../db-server/handlers";
import { join } from "path";
import { socketFileName } from "../path";

const main = async () => {
  const appDir = process.env.APP_DIR;
  if (!appDir) {
    console.error("No app directory provided");
    process.exit(1);
  }

  const dbClient = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: join(appDir, socketFileName),
      }),
    ],
  });

  const server = new McpServer({
    name: "duckdb-memory-server",
    version: "1.1.2",
  });

  server.tool(
    "create_entities",
    "Create multiple new entities in the knowledge graph",
    {
      entities: z.array(EntityObject),
    },
    async ({ entities }) => {
      const result = await dbClient.createEntities.mutate({
        entities,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "create_relations",
    "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
    {
      relations: z.array(RelationObject),
    },
    async ({ relations }) => {
      const result = await dbClient.createRelations.mutate({
        relations,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "add_observations",
    "Add new observations to existing entities in the knowledge graph",
    {
      observations: z.array(ObservationObject),
    },
    async ({ observations }) => {
      const result = await dbClient.addObservations.mutate({
        observations,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "delete_entities",
    "Delete multiple entities and their associated relations from the knowledge graph",
    {
      entityNames: z
        .array(z.string())
        .describe("An array of entity names to delete"),
    },
    async ({ entityNames }) => {
      await dbClient.deleteEntities.mutate({
        entityNames,
      });

      return {
        content: [{ type: "text", text: "Entities deleted successfully" }],
      };
    }
  );

  server.tool(
    "delete_observations",
    "Delete specific observations from entities in the knowledge graph",
    {
      deletions: z.array(
        z.object({
          entityName: z
            .string()
            .describe("The name of the entity containing the observations"),
          contents: z
            .array(z.string())
            .describe("An array of observations to delete"),
        })
      ),
    },
    async ({ deletions }) => {
      await dbClient.deleteObservations.mutate({
        observations: deletions,
      });

      return {
        content: [{ type: "text", text: "Observations deleted successfully" }],
      };
    }
  );

  server.tool(
    "delete_relations",
    "Delete multiple relations from the knowledge graph",
    {
      relations: z
        .array(
          z.object({
            from: z
              .string()
              .describe("The name of the entity where the relation starts"),
            to: z
              .string()
              .describe("The name of the entity where the relation ends"),
            relationType: z.string().describe("The type of the relation"),
          })
        )
        .describe("An array of relations to delete"),
    },
    async ({ relations }) => {
      await dbClient.deleteRelations.mutate({
        relations,
      });

      return {
        content: [{ type: "text", text: "Relations deleted successfully" }],
      };
    }
  );

  server.tool(
    "search_nodes",
    "Search for nodes in the knowledge graph based on a query",
    {
      query: z
        .string()
        .describe(
          "The search query to match against entity names, types, and observation content"
        ),
    },
    async ({ query }) => {
      const result = await dbClient.searchNodes.query({
        query,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "open_nodes",
    "Open specific nodes in the knowledge graph by their names",
    {
      names: z
        .array(z.string())
        .describe("An array of entity names to retrieve"),
    },
    async ({ names }) => {
      const result = await dbClient.openNodes.query({
        names,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
