import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "./types";
import { Logger, ConsoleLogger } from "./logger";
import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import Fuse from "fuse.js";
import { dirname } from "path";
import { existsSync, mkdirSync } from "fs";

/**
 * An implementation of the KnowledgeGraphManagerInterface that uses DuckDB and Fuse.js
 */
export class DuckDBKnowledgeGraphManager
  implements KnowledgeGraphManagerInterface
{
  private instance: DuckDBInstance;
  private conn: DuckDBConnection;
  private fuse: Fuse<Entity>;
  private initialized: boolean = false;
  private dbPath: string;
  private logger: Logger;

  /**
   * Constructor
   * @param dbPath Path to the database file
   * @param logger Optional logger instance
   */
  constructor(dbPath: string, logger?: Logger) {
    this.dbPath = dbPath;
    this.logger = logger || new ConsoleLogger();

    // Create directory if it doesn't exist
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    // DuckDB initialization is asynchronous, so we don't initialize in the constructor but in the initialize() method
    this.instance = null as any;
    this.conn = null as any;

    // Initialize Fuse.js
    this.fuse = new Fuse<Entity>([], {
      keys: ["name", "entityType", "observations"],
      includeScore: true,
      threshold: 0.4, // Search strictness (closer to 0 means more strict)
    });
  }

  /**
   * Initialize the database
   * @private
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize DuckDB
      if (!this.instance) {
        this.instance = await DuckDBInstance.create(this.dbPath);
        this.conn = await this.instance.connect();
      }

      // Create tables
      await this.conn.run(`
        CREATE TABLE IF NOT EXISTS entities (
          name VARCHAR PRIMARY KEY,
          entityType VARCHAR
        );
      `);

      await this.conn.run(`
        CREATE TABLE IF NOT EXISTS observations (
          entityName VARCHAR,
          content VARCHAR,
          FOREIGN KEY (entityName) REFERENCES entities(name),
          PRIMARY KEY (entityName, content)
        );
      `);

      await this.conn.run(`
        CREATE TABLE IF NOT EXISTS relations (
          from_entity VARCHAR,
          to_entity VARCHAR,
          relationType VARCHAR,
          FOREIGN KEY (from_entity) REFERENCES entities(name),
          FOREIGN KEY (to_entity) REFERENCES entities(name),
          PRIMARY KEY (from_entity, to_entity, relationType)
        );
      `);

      // Create indexes
      await this.conn.run(`
        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entityType);
      `);

      await this.conn.run(`
        CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entityName);
        CREATE INDEX IF NOT EXISTS idx_observations_content ON observations(content);
      `);

      await this.conn.run(`
        CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relationType);
      `);

      // Build Fuse.js index
      const entities = await this.getAllEntities();
      this.fuse.setCollection(entities);

      this.initialized = true;
    } catch (error) {
      this.logger.error("Failed to initialize database:", { error });
      this.initialized = true;
    }
  }

  /**
   * Get all entities from the database
   * @private
   */
  private async getAllEntities(): Promise<Entity[]> {
    try {
      // Retrieve entities and observations at once using LEFT JOIN
      const reader = await this.conn.runAndReadAll(`
        SELECT e.name, e.entityType, o.content
        FROM entities e
        LEFT JOIN observations o ON e.name = o.entityName
      `);
      const rows = reader.getRows();

      // Group results by entity
      const entitiesMap = new Map<string, Entity>();

      for (const row of rows) {
        const name = row[0] as string;
        const entityType = row[1] as string;
        const content = row[2] as string | null;

        if (!entitiesMap.has(name)) {
          // Create a new entity
          entitiesMap.set(name, {
            name,
            entityType,
            observations: content ? [content] : [],
          });
        } else if (content) {
          // Add observation to existing entity
          entitiesMap.get(name)!.observations.push(content);
        }
      }

      return Array.from(entitiesMap.values());
    } catch (error) {
      this.logger.error("Error getting all entities:", { error });
      return [];
    }
  }

  /**
   * Create entities
   * @param entities Array of entities to create
   * @returns Array of created entities
   */
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    await this.initialize();

    const createdEntities: Entity[] = [];

    // Begin transaction
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // Get existing entity names
      const existingEntitiesReader = await this.conn.runAndReadAll(
        "SELECT name FROM entities"
      );
      const existingEntitiesData = existingEntitiesReader.getRows();
      const nameColumnIndex = 0; // name column is the first column
      const existingNames = new Set(
        existingEntitiesData.map((row) => row[nameColumnIndex] as string)
      );

      // Filter new entities
      const newEntities = entities.filter(
        (entity) => !existingNames.has(entity.name)
      );

      // Insert new entities
      for (const entity of newEntities) {
        // Insert entity
        await this.conn.run(
          "INSERT INTO entities (name, entityType) VALUES (?, ?)",
          [entity.name, entity.entityType]
        );

        // Insert observations
        for (const observation of entity.observations) {
          await this.conn.run(
            "INSERT INTO observations (entityName, content) VALUES (?, ?)",
            [entity.name, observation]
          );
        }

        createdEntities.push(entity);
      }

      // Commit transaction
      await this.conn.run("COMMIT");

      // Update Fuse.js index
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);

      return createdEntities;
    } catch (error) {
      // Rollback in case of error
      await this.conn.run("ROLLBACK");
      this.logger.error("Error creating entities:", { error });
      throw error;
    }
  }

  /**
   * Create relations
   * @param relations Array of relations to create
   * @returns Array of created relations
   */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    await this.initialize();

    // Begin transaction
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // Get the set of entity names
      const entityNamesReader = await this.conn.runAndReadAll(
        "SELECT name FROM entities"
      );
      const entityNamesData = entityNamesReader.getRows();
      const nameColumnIndex = 0; // name column is the first column
      const entityNames = new Set(
        entityNamesData.map((row) => row[nameColumnIndex] as string)
      );

      // Filter valid relations (both from and to entities must exist)
      const validRelations = relations.filter(
        (relation) =>
          entityNames.has(relation.from) && entityNames.has(relation.to)
      );

      // Get existing relations
      const existingRelationsReader = await this.conn.runAndReadAll(
        'SELECT from_entity as "from", to_entity as "to", relationType FROM relations'
      );
      const existingRelationsData = existingRelationsReader.getRows();

      // Convert results to an array of Relation objects
      const existingRelations = existingRelationsData.map((row) => {
        return {
          from: row[0] as string,
          to: row[1] as string,
          relationType: row[2] as string,
        };
      });

      // Filter new relations
      const newRelations = validRelations.filter(
        (newRel) =>
          !existingRelations.some(
            (existingRel) =>
              existingRel.from === newRel.from &&
              existingRel.to === newRel.to &&
              existingRel.relationType === newRel.relationType
          )
      );

      // Insert new relations
      for (const relation of newRelations) {
        await this.conn.run(
          "INSERT INTO relations (from_entity, to_entity, relationType) VALUES (?, ?, ?)",
          [relation.from, relation.to, relation.relationType]
        );
      }

      // Commit transaction
      await this.conn.run("COMMIT");

      return newRelations;
    } catch (error) {
      // Rollback in case of error
      await this.conn.run("ROLLBACK");
      this.logger.error("Error creating relations:", { error });
      throw error;
    }
  }

  /**
   * Add observations to entities
   * @param observations Array of observations to add
   * @returns Array of added observations
   */
  async addObservations(
    observations: Array<Observation>
  ): Promise<Observation[]> {
    await this.initialize();

    const addedObservations: Observation[] = [];

    // Begin transaction
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // Process each observation
      for (const observation of observations) {
        // Check if entity exists
        const entityReader = await this.conn.runAndReadAll(
          "SELECT name FROM entities WHERE name = ?",
          [observation.entityName as string]
        );
        const entityRows = entityReader.getRows();
        // Confirm existence by row count

        // If entity exists
        if (entityRows.length > 0) {
          // Get existing observations
          const existingObservationsReader = await this.conn.runAndReadAll(
            "SELECT content FROM observations WHERE entityName = ?",
            [observation.entityName as string]
          );
          const existingObservationsData = existingObservationsReader.getRows();
          const contentColumnIndex = 0; // content column is the first column
          const existingObservations = new Set(
            existingObservationsData.map(
              (row) => row[contentColumnIndex] as string
            )
          );

          // Filter new observations
          const newContents = observation.contents.filter(
            (content) => !existingObservations.has(content)
          );

          // Insert new observations
          if (newContents.length > 0) {
            for (const content of newContents) {
              await this.conn.run(
                "INSERT INTO observations (entityName, content) VALUES (?, ?)",
                [observation.entityName, content]
              );
            }

            addedObservations.push({
              entityName: observation.entityName,
              contents: newContents,
            });
          }
        }
      }

      // Commit transaction
      await this.conn.run("COMMIT");

      // Update Fuse.js index
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);

      return addedObservations;
    } catch (error) {
      // Rollback in case of error
      await this.conn.run("ROLLBACK");
      this.logger.error("Error adding observations:", { error });
      throw error;
    }
  }

  /**
   * Delete entities
   * @param entityNames Array of entity names to delete
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.initialize();

    if (entityNames.length === 0) return;

    try {
      // Create placeholders
      const placeholders = entityNames.map(() => "?").join(",");

      // Delete related observations first
      try {
        await this.conn.run(
          `DELETE FROM observations WHERE entityName IN (${placeholders})`,
          entityNames
        );
      } catch (error) {
        this.logger.error("Error deleting observations:", { error });
        // Ignore error and continue
      }

      // Delete related relations
      try {
        await this.conn.run(
          `DELETE FROM relations WHERE from_entity IN (${placeholders}) OR to_entity IN (${placeholders})`,
          [...entityNames, ...entityNames]
        );
      } catch (error) {
        this.logger.error("Error deleting relations:", { error });
        // Ignore error and continue
      }

      // Delete entities
      await this.conn.run(
        `DELETE FROM entities WHERE name IN (${placeholders})`,
        entityNames
      );

      // Update Fuse.js index
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);
    } catch (error) {
      this.logger.error("Error deleting entities:", { error });
      throw error;
    }
  }

  /**
   * Delete observations from entities
   * @param deletions Array of observations to delete
   */
  async deleteObservations(deletions: Array<Observation>): Promise<void> {
    await this.initialize();

    // Begin transaction
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // Process each deletion
      for (const deletion of deletions) {
        // If there are observations to delete
        if (deletion.contents.length > 0) {
          for (const content of deletion.contents) {
            await this.conn.run(
              "DELETE FROM observations WHERE entityName = ? AND content = ?",
              [deletion.entityName, content]
            );
          }
        }
      }

      // Commit transaction
      await this.conn.run("COMMIT");

      // Update Fuse.js index
      const allEntities = await this.getAllEntities();
      this.fuse.setCollection(allEntities);
    } catch (error) {
      // Rollback in case of error
      await this.conn.run("ROLLBACK");
      this.logger.error("Error deleting observations:", { error });
      throw error;
    }
  }

  /**
   * Delete relations
   * @param relations Array of relations to delete
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.initialize();

    // Begin transaction
    await this.conn.run("BEGIN TRANSACTION");

    try {
      // Delete each relation
      for (const relation of relations) {
        await this.conn.run(
          "DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relationType = ?",
          [relation.from, relation.to, relation.relationType]
        );
      }

      // Commit transaction
      await this.conn.run("COMMIT");
    } catch (error) {
      // Rollback in case of error
      await this.conn.run("ROLLBACK");
      this.logger.error("Error deleting relations:", { error });
      throw error;
    }
  }

  /**
   * Search for entities
   * @param query Search query
   * @returns Knowledge graph with matching entities and their relations
   */
  async searchNodes(query: string): Promise<KnowledgeGraph> {
    await this.initialize();

    if (!query || query.trim() === "") {
      return { entities: [], relations: [] };
    }

    // Get all entities
    const allEntities = await this.getAllEntities();

    // Update Fuse.js collection
    this.fuse.setCollection(allEntities);

    // Execute search
    const results = this.fuse.search(query);

    // Extract entities from search results (remove duplicates)
    const uniqueEntities = new Map<string, Entity>();
    for (const result of results) {
      if (!uniqueEntities.has(result.item.name)) {
        uniqueEntities.set(result.item.name, result.item);
      }
    }

    const entities = Array.from(uniqueEntities.values());

    // Create a set of entity names
    const entityNames = entities.map((entity) => entity.name);

    if (entityNames.length === 0) {
      return { entities: [], relations: [] };
    }

    // Create placeholders
    const placeholders = entityNames.map(() => "?").join(",");

    // Get related relations
    const relationsReader = await this.conn.runAndReadAll(
      `
      SELECT from_entity as "from", to_entity as "to", relationType
      FROM relations
      WHERE from_entity IN (${placeholders})
      OR to_entity IN (${placeholders})
      `,
      [...entityNames, ...entityNames]
    );
    const relationsData = relationsReader.getRows();

    // Convert results to an array of Relation objects
    const relations = relationsData.map((row) => {
      return {
        from: row[0] as string,
        to: row[1] as string,
        relationType: row[2] as string,
      };
    });

    return {
      entities,
      relations,
    };
  }

  /**
   * Read the entire knowledge graph
   * @returns The complete knowledge graph
   */
  async readGraph(): Promise<KnowledgeGraph> {
    await this.initialize();

    // Get all entities
    const entities = await this.getAllEntities();

    // Get all relations
    const relationsReader = await this.conn.runAndReadAll(
      'SELECT from_entity as "from", to_entity as "to", relationType FROM relations'
    );
    const relationsData = relationsReader.getRows();

    // Convert results to an array of Relation objects
    const relations = relationsData.map((row) => {
      return {
        from: row[0] as string,
        to: row[1] as string,
        relationType: row[2] as string,
      };
    });

    return {
      entities,
      relations,
    };
  }

  /**
   * Get entities by name
   * @param names Array of entity names
   * @returns Knowledge graph with matching entities and their relations
   */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    await this.initialize();

    if (names.length === 0) {
      return { entities: [], relations: [] };
    }

    try {
      // Create placeholders
      const placeholders = names.map(() => "?").join(",");

      // Retrieve entities and observations at once using LEFT JOIN
      const reader = await this.conn.runAndReadAll(
        `
        SELECT e.name, e.entityType, o.content
        FROM entities e
        LEFT JOIN observations o ON e.name = o.entityName
        WHERE e.name IN (${placeholders})
      `,
        names
      );
      const rows = reader.getRows();

      // Group results by entity
      const entitiesMap = new Map<string, Entity>();

      for (const row of rows) {
        const name = row[0] as string;
        const entityType = row[1] as string;
        const content = row[2] as string | null;

        if (!entitiesMap.has(name)) {
          // Create a new entity
          entitiesMap.set(name, {
            name,
            entityType,
            observations: content ? [content] : [],
          });
        } else if (content) {
          // Add observation to existing entity
          entitiesMap.get(name)!.observations.push(content);
        }
      }

      const entities = Array.from(entitiesMap.values());

      // Create a set of entity names
      const entityNames = entities.map((entity) => entity.name);

      // Get related relations
      if (entityNames.length > 0) {
        const placeholders = entityNames.map(() => "?").join(",");
        const relationsReader = await this.conn.runAndReadAll(
          `
        SELECT from_entity as "from", to_entity as "to", relationType
        FROM relations
        WHERE from_entity IN (${placeholders})
        OR to_entity IN (${placeholders})
        `,
          [...entityNames, ...entityNames]
        );
        const relationsData = relationsReader.getRows();

        // Convert results to an array of Relation objects
        const relations = relationsData.map((row) => {
          return {
            from: row[0] as string,
            to: row[1] as string,
            relationType: row[2] as string,
          };
        });

        return {
          entities,
          relations,
        };
      } else {
        return {
          entities,
          relations: [],
        };
      }
    } catch (error) {
      this.logger.error("Error opening nodes:", { error });
      return { entities: [], relations: [] };
    }
  }
}
