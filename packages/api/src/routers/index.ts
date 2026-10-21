import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { alertsRouter } from "./alerts";
import { connectionsRouter } from "./connections";
import { demoRouter } from "./demo";
import { incidentsRouter } from "./incidents";
import { newsRouter } from "./news";
import { poisRouter } from "./pois";
import { riskRouter } from "./risk";
import { routeNotesRouter } from "./route-notes";
import { routeReviewRouter } from "./route-review";
import { tripsRouter } from "./trips";
import { vehiclesRouter } from "./vehicles";

export const appRouter = {
	connections: connectionsRouter,
	vehicles: vehiclesRouter,
	trips: tripsRouter,
	alerts: alertsRouter,
	incidents: incidentsRouter,
	pois: poisRouter,
	news: newsRouter,
	demo: demoRouter,
	risk: riskRouter,
	routeReview: routeReviewRouter,
	routeNotes: routeNotesRouter,
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session.user,
		};
	}),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
