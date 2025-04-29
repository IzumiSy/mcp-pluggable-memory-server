import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { EntityObject, ObservationObject, RelationObject } from "../schema";

export const appRouter = router({
  healthcheck: publicProcedure.query(() => "ok"),

  createEntities: publicProcedure
    .input(z.object({ entities: z.array(EntityObject) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.manager.createEntities(input.entities);
    }),

  createRelations: publicProcedure
    .input(z.object({ relations: z.array(RelationObject) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.manager.createRelations(input.relations);
    }),

  addObservations: publicProcedure
    .input(z.object({ observations: z.array(ObservationObject) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.manager.addObservations(input.observations);
    }),

  deleteEntities: publicProcedure
    .input(z.object({ entityNames: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.manager.deleteEntities(input.entityNames);
      return { success: true };
    }),

  deleteObservations: publicProcedure
    .input(z.object({ observations: z.array(ObservationObject) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.manager.deleteObservations(input.observations);
      return { success: true };
    }),

  deleteRelations: publicProcedure
    .input(z.object({ relations: z.array(RelationObject) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.manager.deleteRelations(input.relations);
      return { success: true };
    }),

  searchNodes: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.manager.searchNodes(input.query);
    }),

  openNodes: publicProcedure
    .input(z.object({ names: z.array(z.string()) }))
    .query(async ({ input, ctx }) => {
      return await ctx.manager.openNodes(input.names);
    }),
});

export type AppRouter = typeof appRouter;
