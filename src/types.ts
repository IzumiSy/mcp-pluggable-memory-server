/**
 * The primary nodes in the knowledge graph
 */
export type Entity = {
  name: string;
  entityType: string;
  observations: string[];
};

/**
 * Relations define directed connections between entities.
 *
 * They are always stored in active voice and describe how entities interact or relate to each other
 */
export type Relation = {
  from: string;
  to: string;
  relationType: string;
};

/**
 * Observations are discrete pieces of information about an entity
 */
export type Observation = {
  entityName: string;
  contents: string[];
};

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
