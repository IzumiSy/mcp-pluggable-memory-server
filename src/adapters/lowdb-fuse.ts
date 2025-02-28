import {
  KnowledgeGraphManagerInterface,
  Entity,
  Relation,
  Observation,
  KnowledgeGraph,
} from "../types";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import Fuse from "fuse.js";

/**
 * Type definition for LowDB data
 */
type LowDBData = KnowledgeGraph;

/**
 * An implementation of the KnowledgeGraphManagerInterface that uses LowDB and Fuse.js
 */
export class LowDBFuseKnowledgeGraphManager
  implements KnowledgeGraphManagerInterface
{
  private db: Low<LowDBData>;
  private fuse: Fuse<Entity>;
  private initialized: boolean = false;

  /**
   * Constructor
   * @param dbPath Path to the database file
   */
  constructor(dbPath: string) {
    // Initialize LowDB
    const adapter = new JSONFile<LowDBData>(dbPath);
    this.db = new Low<LowDBData>(adapter, { entities: [], relations: [] });

    // Initialize Fuse.js (start with empty collection, data will be loaded later)
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
      // Load database
      await this.db.read();

      // Initialize with empty data if database is empty
      if (this.db.data === null) {
        this.db.data = { entities: [], relations: [] };
        await this.db.write();
      }

      // Build Fuse.js search index
      this.fuse.setCollection(this.db.data.entities);

      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize database:", error);
      // Initialize with empty data if initialization fails
      this.db.data = { entities: [], relations: [] };
      this.fuse.setCollection([]);
      this.initialized = true;
    }
  }

  /**
   * Save the database
   * @private
   */
  private async saveDatabase(): Promise<void> {
    await this.db.write();
    // Update search index
    this.fuse.setCollection(this.db.data!.entities);
  }

  /**
   * Create entities
   * @param entities Array of entities to create
   * @returns Array of created entities
   */
  async createEntities(entities: Entity[]): Promise<Entity[]> {
    await this.initialize();

    // Get existing entity names
    const existingNames = new Set(this.db.data!.entities.map((e) => e.name));

    // Filter out entities that already exist
    const newEntities = entities.filter(
      (entity) => !existingNames.has(entity.name)
    );

    // Add new entities
    if (newEntities.length > 0) {
      this.db.data!.entities.push(...newEntities);
      await this.saveDatabase();
    }

    return newEntities;
  }

  /**
   * Create relations
   * @param relations Array of relations to create
   * @returns Array of created relations
   */
  async createRelations(relations: Relation[]): Promise<Relation[]> {
    await this.initialize();

    // Create a set of entity names
    const entityNames = new Set(this.db.data!.entities.map((e) => e.name));

    // Filter valid relations (both 'from' and 'to' entities must exist)
    const validRelations = relations.filter(
      (relation) =>
        entityNames.has(relation.from) && entityNames.has(relation.to)
    );

    // Filter out relations that already exist
    const existingRelations = this.db.data!.relations;
    const newRelations = validRelations.filter(
      (newRel) =>
        !existingRelations.some(
          (existingRel) =>
            existingRel.from === newRel.from &&
            existingRel.to === newRel.to &&
            existingRel.relationType === newRel.relationType
        )
    );

    // Add new relations
    if (newRelations.length > 0) {
      this.db.data!.relations.push(...newRelations);
      await this.saveDatabase();
    }

    return newRelations;
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

    // Process each observation
    for (const observation of observations) {
      // Find the entity
      const entityIndex = this.db.data!.entities.findIndex(
        (e) => e.name === observation.entityName
      );

      // If entity exists
      if (entityIndex !== -1) {
        const entity = this.db.data!.entities[entityIndex];
        const existingObservations = new Set(entity.observations);

        // Add only new observations (avoid duplicates)
        const newContents = observation.contents.filter(
          (content) => !existingObservations.has(content)
        );

        if (newContents.length > 0) {
          entity.observations.push(...newContents);
          addedObservations.push({
            entityName: observation.entityName,
            contents: newContents,
          });
        }
      }
    }

    // Save if changes were made
    if (addedObservations.length > 0) {
      await this.saveDatabase();
    }

    return addedObservations;
  }

  /**
   * Delete entities
   * @param entityNames Array of entity names to delete
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.initialize();

    const nameSet = new Set(entityNames);

    // Delete entities
    this.db.data!.entities = this.db.data!.entities.filter(
      (entity) => !nameSet.has(entity.name)
    );

    // Delete related relations
    this.db.data!.relations = this.db.data!.relations.filter(
      (relation) => !nameSet.has(relation.from) && !nameSet.has(relation.to)
    );

    await this.saveDatabase();
  }

  /**
   * Delete observations from entities
   * @param deletions Array of observations to delete
   */
  async deleteObservations(deletions: Array<Observation>): Promise<void> {
    await this.initialize();

    let hasChanges = false;

    // Process each deletion
    for (const deletion of deletions) {
      // Find the entity
      const entityIndex = this.db.data!.entities.findIndex(
        (e) => e.name === deletion.entityName
      );

      // If entity exists
      if (entityIndex !== -1) {
        const entity = this.db.data!.entities[entityIndex];
        const deleteSet = new Set(deletion.contents);

        // Remove specified observations
        const originalLength = entity.observations.length;
        entity.observations = entity.observations.filter(
          (obs) => !deleteSet.has(obs)
        );

        // Check if any changes were made
        if (originalLength !== entity.observations.length) {
          hasChanges = true;
        }
      }
    }

    // Save if changes were made
    if (hasChanges) {
      await this.saveDatabase();
    }
  }

  /**
   * Delete relations
   * @param relations Array of relations to delete
   */
  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.initialize();

    const originalLength = this.db.data!.relations.length;

    // Remove specified relations
    this.db.data!.relations = this.db.data!.relations.filter(
      (existingRel) =>
        !relations.some(
          (delRel) =>
            existingRel.from === delRel.from &&
            existingRel.to === delRel.to &&
            existingRel.relationType === delRel.relationType
        )
    );

    // Save if changes were made
    if (originalLength !== this.db.data!.relations.length) {
      await this.saveDatabase();
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

    // Execute search with Fuse.js
    const results = this.fuse.search(query);

    // Extract entities from search results (remove duplicates)
    const uniqueEntities = new Map<string, Entity>();
    for (const result of results) {
      if (!uniqueEntities.has(result.item.name)) {
        uniqueEntities.set(result.item.name, result.item);
      }
    }

    const entities = Array.from(uniqueEntities.values());

    // Get entity names for relation filtering
    const entityNames = new Set(entities.map((entity) => entity.name));

    // Filter relations that involve the found entities
    const relations = this.db.data!.relations.filter(
      (relation) =>
        entityNames.has(relation.from) || entityNames.has(relation.to)
    );

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

    const nameSet = new Set(names);

    // Filter entities by name
    const entities = this.db.data!.entities.filter((entity) =>
      nameSet.has(entity.name)
    );

    // Get entity names for relation filtering
    const entityNames = new Set(entities.map((entity) => entity.name));

    // Filter relations that involve the found entities
    const relations = this.db.data!.relations.filter(
      (relation) =>
        entityNames.has(relation.from) || entityNames.has(relation.to)
    );

    return {
      entities,
      relations,
    };
  }
}
