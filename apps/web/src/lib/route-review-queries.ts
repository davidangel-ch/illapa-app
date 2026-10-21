import type { RouteReviewPlaceId } from "@hack-the-andes-project/business/route-review/places";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_REVIEW_QUERY_KEY } from "@/constants";
import { client } from "@/utils/orpc";
import { invalidateFleetQueries, useFleetQueries } from "./fleet-queries";
export const routeReviewClient = client;

const authRoute = getRouteApi("/_auth");
export function useRouteReviewQueries() {
	const { session } = authRoute.useRouteContext();
	const scope = {
		sessionId: session.data?.session.id,
		organizationId: session.data?.session.activeOrganizationId,
	};
	const fleetQueries = useFleetQueries();
	return {
		vehicles: fleetQueries.vehicles,
		plannedTrips: queryOptions({
			queryKey: [...ROUTE_REVIEW_QUERY_KEY, "planned-trips", scope],
			queryFn: () => routeReviewClient.trips.listPlanned(),
		}),
		plannedTrip: (id: string) =>
			queryOptions({
				queryKey: [...ROUTE_REVIEW_QUERY_KEY, "planned-trips", scope, id],
				queryFn: () => routeReviewClient.trips.get({ id }),
			}),
		routeNote: (
			originPlaceId: RouteReviewPlaceId,
			destinationPlaceId: RouteReviewPlaceId,
		) =>
			queryOptions({
				queryKey: [
					...ROUTE_REVIEW_QUERY_KEY,
					"route-note",
					scope,
					originPlaceId,
					destinationPlaceId,
				],
				queryFn: () =>
					routeReviewClient.routeNotes.get({
						originPlaceId,
						destinationPlaceId,
					}),
			}),
	};
}

export async function invalidateRouteReviewQueries(queryClient: QueryClient) {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: ROUTE_REVIEW_QUERY_KEY }),
		invalidateFleetQueries(queryClient),
	]);
}
