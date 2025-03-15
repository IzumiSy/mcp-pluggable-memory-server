#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { KnowledgeGraphClient } from "./client";
import {
  EntityObject,
  ObservationObject,
  RelationObject,
} from "./db-server/types";

// Create an MCP server
const server = new McpServer({
  name: "duckdb-memory-server",
  version: "1.1.2",
});

const socketPath =
  process.env.SOCKET_PATH ||
  join(homedir(), ".local", "share", "duckdb-memory-server", "db-server.sock");

// DBサーバーと通信するクライアントを作成
const knowledgeGraphManager = new KnowledgeGraphClient(socketPath);

// Create entities tool
server.tool(
  "create_entities",
  "Create multiple new entities in the knowledge graph",
  {
    entities: z.array(EntityObject),
  },
  async ({ entities }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await knowledgeGraphManager.createEntities(entities),
          null,
          2
        ),
      },
    ],
  })
);

// Create relations tool
server.tool(
  "create_relations",
  "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
  {
    relations: z.array(RelationObject),
  },
  async ({ relations }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await knowledgeGraphManager.createRelations(relations),
          null,
          2
        ),
      },
    ],
  })
);

// Add observations tool
server.tool(
  "add_observations",
  "Add new observations to existing entities in the knowledge graph",
  {
    observations: z.array(ObservationObject),
  },
  async ({ observations }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await knowledgeGraphManager.addObservations(observations),
          null,
          2
        ),
      },
    ],
  })
);

// Delete entities tool
server.tool(
  "delete_entities",
  "Delete multiple entities and their associated relations from the knowledge graph",
  {
    entityNames: z
      .array(z.string())
      .describe("An array of entity names to delete"),
  },
  async ({ entityNames }) => {
    await knowledgeGraphManager.deleteEntities(entityNames);
    return {
      content: [{ type: "text", text: "Entities deleted successfully" }],
    };
  }
);

// Delete observations tool
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
    await knowledgeGraphManager.deleteObservations(deletions);
    return {
      content: [{ type: "text", text: "Observations deleted successfully" }],
    };
  }
);

// Delete relations tool
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
    await knowledgeGraphManager.deleteRelations(relations);
    return {
      content: [{ type: "text", text: "Relations deleted successfully" }],
    };
  }
);

// Search nodes tool
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
  async ({ query }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await knowledgeGraphManager.searchNodes(query),
          null,
          2
        ),
      },
    ],
  })
);

// Open nodes tool
server.tool(
  "open_nodes",
  "Open specific nodes in the knowledge graph by their names",
  {
    names: z.array(z.string()).describe("An array of entity names to retrieve"),
  },
  async ({ names }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await knowledgeGraphManager.openNodes(names),
          null,
          2
        ),
      },
    ],
  })
);

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // プロセス終了時にクライアントを閉じる
  process.on("SIGINT", async () => {
    await knowledgeGraphManager.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await knowledgeGraphManager.close();
    process.exit(0);
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
