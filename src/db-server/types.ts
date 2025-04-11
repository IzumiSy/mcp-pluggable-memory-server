import { z } from "zod";

/**
 * The primary nodes in the knowledge graph
 */
export const EntityObject = z.object({
  name: z.string().describe("The name of the entity"),
  entityType: z.string().describe("The type of the entity"),
  observations: z
    .array(z.string())
    .describe("An array of observation contents associated with the entity"),
});
export type Entity = z.infer<typeof EntityObject>;

/**
 * Relations define directed connections between entities.
 *
 * They are always stored in active voice and describe how entities interact or relate to each other
 */
export const RelationObject = z.object({
  from: z.string().describe("The name of the entity where the relation starts"),
  to: z.string().describe("The name of the entity where the relation ends"),
  relationType: z.string().describe("The type of the relation"),
});
export type Relation = {
  from: string;
  to: string;
  relationType: string;
};

/**
 * Observations are discrete pieces of information about an entity
 */
export const ObservationObject = z.object({
  entityName: z
    .string()
    .describe("The name of the entity to add the observations to"),
  contents: z
    .array(z.string())
    .describe("An array of observation contents to add"),
});
export type Observation = z.infer<typeof ObservationObject>;

/**
 * The knowledge graph is the primary data structure for storing information in the system
 */
export type KnowledgeGraph = {
  entities: Entity[];
  relations: Relation[];
};

/**
 * The KnowledgeGraphManagerInterface is the primary interface for interacting with the knowledge graph
 */
export type KnowledgeGraphManagerInterface = {
  createEntities(entities: Entity[]): Promise<Entity[]>;
  createRelations(relations: Relation[]): Promise<Relation[]>;
  addObservations(observations: Array<Observation>): Promise<Observation[]>;
  deleteEntities(entityNames: string[]): Promise<void>;
  deleteObservations(deletions: Array<Observation>): Promise<void>;
  deleteRelations(relations: Relation[]): Promise<void>;
  searchNodes(query: string): Promise<KnowledgeGraph>;
  openNodes(names: string[]): Promise<KnowledgeGraph>;
};
