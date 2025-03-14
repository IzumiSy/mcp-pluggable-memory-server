#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DuckDBKnowledgeGraphManager } from "./manager";
import { McpLoggerAdapter } from "./logger";
import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { EntityObject, ObservationObject, RelationObject } from "./types";

// Create an MCP server
const server = new McpServer({
  name: "duckdb-memory-server",
  version: "1.0.0",
});

const logger = new McpLoggerAdapter(server.server);
const knowledgeGraphManager = new DuckDBKnowledgeGraphManager(
  /**
   * Get the database file path based on environment variables or default location
   * @returns The path to the database file
   */
  () => {
    if (process.env.MEMORY_FILE_PATH) {
      // Use environment variable if provided
      return process.env.MEMORY_FILE_PATH;
    }

    // Default path: ~/.local/share/duckdb-memory-server/knowledge-graph.json
    const defaultDir = join(
      homedir(),
      ".local",
      "share",
      "duckdb-memory-server"
    );
    const defaultPath = join(defaultDir, "knowledge-graph.data");

    // Create directory if it doesn't exist
    if (!existsSync(dirname(defaultPath))) {
      mkdirSync(dirname(defaultPath), { recursive: true });
    }

    return defaultPath;
  },
  logger
);

// Create entities tool
server.tool(
  "create_entities",
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
  logger.info("DuckDB Knowledge Graph MCP Server running on stdio");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
