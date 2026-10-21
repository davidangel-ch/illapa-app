import { TRIP_NOT_FOUND_MESSAGE } from "@hack-the-andes-project/api/constants";
import type { PlannedTrip } from "@hack-the-andes-project/api/route-review-schemas";
import { MS_PER_MINUTE } from "@hack-the-andes-project/business/constants";
import { ROUTE_REVIEW_PLACES } from "@hack-the-andes-project/business/route-review/places";
import { tripWindowRiskAssessment } from "@hack-the-andes-project/business/route-review/ranking";
import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@hack-the-andes-project/ui/components/alert";
import { Button } from "@hack-the-andes-project/ui/components/button";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
} from "@hack-the-andes-project/ui/components/empty";
import { FleetConfirmationDialog } from "@hack-the-andes-project/ui/components/fleet-confirmation-dialog";
import { FleetQueryFeedback } from "@hack-the-andes-project/ui/components/fleet-query-feedback";
import { RouteReviewCandidateSkeleton } from "@hack-the-andes-project/ui/components/route-review-candidate-card";
import { RouteReviewCandidateList } from "@hack-the-andes-project/ui/components/route-review-candidate-list";
import { RouteReviewHorizonToggle } from "@hack-the-andes-project/ui/components/route-review-horizon-toggle";
import { RouteReviewMap } from "@hack-the-andes-project/ui/components/route-review-map";
import { RouteReviewTripHeader } from "@hack-the-andes-project/ui/components/route-review-trip-header";
import { Skeleton } from "@hack-the-andes-project/ui/components/skeleton";
import { Spinner } from "@hack-the-andes-project/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RouteNotePanel } from "@/components/route-note-panel";
import {
	ROUTE_REVIEW_MAP_CASING_WIDTH_PX,
	ROUTE_REVIEW_MAP_COMPACT_HEIGHT_PX,
	ROUTE_REVIEW_MAP_COMPACT_LEGEND_PADDING_PX,
	ROUTE_REVIEW_MAP_FIT_PADDING_PX,
	ROUTE_REVIEW_MAP_LEGEND_PADDING_PX,
	ROUTE_REVIEW_MAP_LINE_WIDTH_PX,
	ROUTE_REVIEW_MAP_SELECTED_WIDTH_PX,
} from "@/constants";
import { getRouteReviewLabels } from "@/lib/route-review-labels";
import {
	invalidateRouteReviewQueries,
	routeReviewClient,
	useRouteReviewQueries,
} from "@/lib/route-review-queries";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_auth/dashboard/fleet_/viajes/$tripId")({
	component: PlannedTripPage,
	remountDeps: ({ params }) => params.tripId,
});
function PlannedTripPage() {
	const routeReviewQueries = useRouteReviewQueries();
	const { tripId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const tripQuery = useQuery({
		...routeReviewQueries.plannedTrip(tripId),
		meta: { silentError: true },
		retry: false,
	});
	const vehiclesQuery = useQuery(routeReviewQueries.vehicles);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [horizon, setHorizon] = useState<RouteRiskHorizon>("now");
	const [cancelOpen, setCancelOpen] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const [changeDescription, setChangeDescription] = useState<string | null>(
		null,
	);
	const [nowMs, setNowMs] = useState(Date.now);
	const statusRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<HTMLDivElement>(null);
	const [labels] = useState(getRouteReviewLabels);
	const trip = tripQuery.data;
	const vehicle = vehiclesQuery.data?.find(
		(vehicle) => vehicle.id === trip?.vehicleId,
	);
	const chosen = trip?.review.candidates.find(
		(candidate) => candidate.id === trip.chosenCandidate.id,
	);
	const selectedCandidateId = selectedId ?? trip?.chosenCandidate.id ?? null;
	const updateTrip = async (updated: PlannedTrip) => {
		queryClient.setQueryData(
			routeReviewQueries.plannedTrip(tripId).queryKey,
			updated,
		);
		await invalidateRouteReviewQueries(queryClient);
	};
	const rescoreMutation = useMutation({
		mutationFn: () => routeReviewClient.trips.reevaluate({ id: tripId }),
		onSuccess: async (updated) => {
			const before = trip
				? tripWindowRiskAssessment(
						trip.chosenCandidate.risk,
						trip.departureAt,
						trip.chosenCandidate.durationS,
						trip.lastEvaluatedAt,
					)
				: undefined;
			const after = tripWindowRiskAssessment(
				updated.chosenCandidate.risk,
				updated.departureAt,
				updated.chosenCandidate.durationS,
				updated.lastEvaluatedAt,
			);
			const recommended = updated.review.candidates.find(
				(candidate) => candidate.id === updated.review.recommendedCandidateId,
			);
			setChangeDescription(
				before &&
					after &&
					recommended &&
					(before.score !== after.score ||
						trip?.review.recommendedCandidateId !==
							updated.review.recommendedCandidateId)
					? m.route_review_changed_description({
							route: updated.chosenCandidate.name,
							before: `${labels.riskLevel(before.level)} ${before.score}`,
							after: `${labels.riskLevel(after.level)} ${after.score}`,
							recommended: recommended.name,
						})
					: null,
			);
			await updateTrip(updated);
			setAnnouncement(m.route_review_rescored());
		},
		onError: () =>
			toast.error(
				m.route_review_rescore_error({
					date: trip ? labels.dateTime(trip.lastEvaluatedAt) : "",
				}),
			),
	});
	const chooseMutation = useMutation({
		mutationFn: (candidateId: string) =>
			routeReviewClient.trips.chooseCandidate({ id: tripId, candidateId }),
		onSuccess: async (updated) => {
			await updateTrip(updated);
			setSelectedId(updated.chosenCandidate.id);
			toast.success(
				m.route_review_switched({ route: updated.chosenCandidate.name }),
			);
		},
		onError: (error) =>
			toast.error(error.message || m.route_review_switch_error()),
	});
	const cancelMutation = useMutation({
		mutationFn: () => routeReviewClient.trips.cancel({ id: tripId }),
		onSuccess: async () => {
			if (trip)
				queryClient.setQueryData(
					routeReviewQueries.plannedTrip(tripId).queryKey,
					{ ...trip, status: "cancelled" },
				);
			setCancelOpen(false);
			await invalidateRouteReviewQueries(queryClient);
			toast.success(m.route_review_cancelled_toast());
			requestAnimationFrame(() => statusRef.current?.focus());
		},
	});
	const startMutation = useMutation({
		mutationFn: () => routeReviewClient.trips.start({ id: tripId }),
		onSuccess: async (updated) => {
			await updateTrip(updated);
			toast.success(
				m.route_review_trip_start_success({
					route: updated.chosenCandidate.name,
				}),
				{
					action: {
						label: m.route_review_trip_start_map(),
						onClick: () =>
							navigate({ to: "/dashboard", search: { flota: true } }),
					},
				},
			);
		},
		onError: (error) => toast.error(error.message),
	});
	const busy =
		rescoreMutation.isPending ||
		chooseMutation.isPending ||
		cancelMutation.isPending ||
		startMutation.isPending;
	const canEdit = trip?.status === "planned";
	useEffect(() => {
		const timer = setInterval(() => setNowMs(Date.now()), MS_PER_MINUTE);
		return () => clearInterval(timer);
	}, []);
	if (tripQuery.error?.message === TRIP_NOT_FOUND_MESSAGE)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>{m.route_review_not_found()}</EmptyTitle>
				</EmptyHeader>
				<Button render={<Link to="/dashboard/fleet" />} nativeButton={false}>
					{m.route_review_go_fleet()}
				</Button>
			</Empty>
		);
	if (!trip)
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
				<FleetQueryFeedback
					labels={{
						errorTitle: m.route_review_trip_load_error(),
						errorDescription: m.route_review_trip_load_description(),
						retry: m.query_retry(),
						loading: m.route_review_trip_loading(),
					}}
					isPending={false}
					isError={tripQuery.isError}
					onRetry={() => tripQuery.refetch()}
				/>
				{tripQuery.isPending ? (
					<>
						<Skeleton className="h-24 w-full" />
						<div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[25rem_minmax(0,1fr)]">
							<output
								aria-busy="true"
								aria-label={m.route_review_trip_loading()}
								className="flex flex-col gap-3"
							>
								<RouteReviewCandidateSkeleton />
								<RouteReviewCandidateSkeleton />
								<RouteReviewCandidateSkeleton />
							</output>
							<RouteReviewMap
								candidates={[]}
								selectedCandidateId={null}
								horizon={horizon}
								origin={ROUTE_REVIEW_PLACES.lima}
								destination={ROUTE_REVIEW_PLACES.huancayo}
								onSelectCandidate={setSelectedId}
								labels={labels}
								lineWidthPx={ROUTE_REVIEW_MAP_LINE_WIDTH_PX}
								selectedLineWidthPx={ROUTE_REVIEW_MAP_SELECTED_WIDTH_PX}
								casingWidthPx={ROUTE_REVIEW_MAP_CASING_WIDTH_PX}
								fitPaddingPx={ROUTE_REVIEW_MAP_FIT_PADDING_PX}
								legendPaddingPx={ROUTE_REVIEW_MAP_LEGEND_PADDING_PX}
								compactLegendPaddingPx={
									ROUTE_REVIEW_MAP_COMPACT_LEGEND_PADDING_PX
								}
								compactHeightPx={ROUTE_REVIEW_MAP_COMPACT_HEIGHT_PX}
							/>
						</div>
					</>
				) : null}
			</div>
		);
	const departurePassed = trip.departureAt.getTime() <= nowMs;
	const canCancel = canEdit || trip.status === "active";
	const canStart = canEdit && Boolean(vehicle && vehicle.connectionId !== null);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			<RouteReviewTripHeader
				trip={trip}
				vehiclePlate={vehicle?.plate}
				backLink={
					<Link
						to="/dashboard/fleet"
						className="inline-flex min-h-11 items-center underline underline-offset-4"
					>
						{m.route_review_fleet()}
					</Link>
				}
				canEdit={canEdit}
				canCancel={canCancel}
				canStart={canStart}
				startDisabled={!chosen?.eligibility.eligible}
				departurePassed={departurePassed}
				isBusy={busy}
				isRescoring={rescoreMutation.isPending}
				isStarting={startMutation.isPending}
				onRescore={() => {
					if (trip.departureAt.getTime() > Date.now()) rescoreMutation.mutate();
					else setNowMs(Date.now());
				}}
				onCancel={() => {
					cancelMutation.reset();
					setCancelOpen(true);
				}}
				onStart={() => startMutation.mutate()}
				labels={labels}
				startLabel={m.route_review_trip_start()}
				startingLabel={m.route_review_trip_start_pending()}
				gpsNote={
					canEdit && vehicle?.connectionId === null
						? m.route_review_trip_start_gps_note()
						: undefined
				}
			/>
			<div className="flex min-h-0 flex-1 flex-col xl:flex-row">
				<div className="order-2 flex flex-col gap-4 p-4 xl:order-1 xl:w-100 xl:shrink-0 xl:overflow-y-auto xl:border-r">
					<FleetQueryFeedback
						labels={{
							errorTitle: m.route_review_trip_load_error(),
							errorDescription: m.route_review_trip_load_description(),
							retry: m.query_retry(),
							loading: m.route_review_trip_loading(),
						}}
						isPending={false}
						isError={tripQuery.isError}
						onRetry={() => tripQuery.refetch()}
					/>
					{vehiclesQuery.isError ? (
						<Alert>
							<AlertTitle>{m.route_review_vehicle_error()}</AlertTitle>
							<AlertDescription>
								<Button
									variant="outline"
									onClick={() => vehiclesQuery.refetch()}
								>
									{m.query_retry()}
								</Button>
							</AlertDescription>
						</Alert>
					) : null}
					{!canEdit ? (
						<Alert ref={statusRef} tabIndex={-1}>
							<AlertTitle>{labels.tripStatus(trip.status)}</AlertTitle>
							<AlertDescription>
								{trip.status !== "planned"
									? {
											active: m.route_review_read_only_active,
											completed: m.route_review_read_only_completed,
											cancelled: m.route_review_read_only_cancelled,
										}[trip.status]({
											date: labels.dateTime(trip.lastEvaluatedAt),
										})
									: null}
							</AlertDescription>
						</Alert>
					) : null}
					<RouteNotePanel
						originPlaceId={trip.originPlaceId}
						destinationPlaceId={trip.destinationPlaceId}
					/>
					{!canEdit || departurePassed ? (
						<Button
							variant="outline"
							className="min-h-11"
							render={
								<Link
									to="/dashboard/revisar-ruta"
									search={{
										origen: trip.originPlaceId,
										destino: trip.destinationPlaceId,
										vehiculo: trip.vehicleId,
									}}
								/>
							}
							nativeButton={false}
						>
							{m.route_review_repeat_route()}
						</Button>
					) : null}
					{chosen && !chosen.eligibility.eligible ? (
						<Alert>
							<AlertTitle>
								{m.route_review_chosen_ineligible({
									vehicle: trip.vehicleName ?? "",
									route: chosen.name,
								})}
							</AlertTitle>
						</Alert>
					) : null}
					{changeDescription ? (
						<Alert>
							<AlertTitle>{m.route_review_changed()}</AlertTitle>
							<AlertDescription>{changeDescription}</AlertDescription>
						</Alert>
					) : null}
					<div className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background py-3">
						<RouteReviewHorizonToggle
							horizons={trip.review.horizons}
							value={horizon}
							onValueChange={setHorizon}
							labels={labels}
						/>
						{rescoreMutation.isPending ? (
							<div
								role="status"
								className="flex items-center gap-2 border-primary border-t-2 pt-2"
							>
								<Spinner />
								{labels.rescoring}
							</div>
						) : null}
					</div>
					<RouteReviewCandidateList
						candidates={trip.review.candidates}
						recommendedCandidateId={trip.review.recommendedCandidateId}
						chosenCandidateId={trip.chosenCandidate.id}
						vehicleAxleCount={trip.review.vehicleAxleCount}
						horizon={horizon}
						selectedCandidateId={selectedCandidateId}
						onSelect={setSelectedId}
						onViewMap={(id) => {
							setSelectedId(id);
							mapRef.current?.scrollIntoView({ block: "start" });
						}}
						isBusy={busy}
						labels={labels}
						renderAction={(candidate) =>
							canEdit && candidate.id !== trip.chosenCandidate.id ? (
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => chooseMutation.mutate(candidate.id)}
								>
									{chooseMutation.isPending ? (
										<Spinner data-icon="inline-start" />
									) : null}
									{chooseMutation.isPending ? m.saving() : labels.useThisRoute}
								</Button>
							) : null
						}
					/>
				</div>
				<div
					ref={mapRef}
					className="order-1 h-60 shrink-0 px-4 xl:order-2 xl:h-auto xl:min-h-0 xl:min-w-0 xl:flex-1 xl:p-4"
				>
					<RouteReviewMap
						candidates={trip.review.candidates}
						selectedCandidateId={selectedCandidateId}
						chosenCandidateId={trip.chosenCandidate.id}
						horizon={horizon}
						origin={ROUTE_REVIEW_PLACES[trip.originPlaceId]}
						destination={ROUTE_REVIEW_PLACES[trip.destinationPlaceId]}
						onSelectCandidate={(id) => {
							setSelectedId(id);
							document
								.getElementById(`route-review-candidate-${id}`)
								?.scrollIntoView({ block: "nearest" });
						}}
						labels={labels}
						className="h-full"
						isBusy={rescoreMutation.isPending}
						vehicleAxleCount={trip.review.vehicleAxleCount}
						vehicleName={trip.vehicleName}
						lineWidthPx={ROUTE_REVIEW_MAP_LINE_WIDTH_PX}
						selectedLineWidthPx={ROUTE_REVIEW_MAP_SELECTED_WIDTH_PX}
						casingWidthPx={ROUTE_REVIEW_MAP_CASING_WIDTH_PX}
						fitPaddingPx={ROUTE_REVIEW_MAP_FIT_PADDING_PX}
						legendPaddingPx={ROUTE_REVIEW_MAP_LEGEND_PADDING_PX}
						compactLegendPaddingPx={ROUTE_REVIEW_MAP_COMPACT_LEGEND_PADDING_PX}
						compactHeightPx={ROUTE_REVIEW_MAP_COMPACT_HEIGHT_PX}
					/>
				</div>
			</div>
			<FleetConfirmationDialog
				open={cancelOpen}
				title={m.route_review_cancel_title()}
				description={
					trip.status === "active"
						? m.route_review_cancel_active_description({
								trip: trip.name,
								vehicle: trip.vehicleName ?? "",
							})
						: m.route_review_cancel_description({
								trip: trip.name,
								vehicle: trip.vehicleName ?? "",
							})
				}
				actionLabel={labels.cancelTrip}
				pendingLabel={m.route_review_cancelling()}
				cancelLabel={m.route_review_cancel_back()}
				errorTitle={m.route_review_cancel_error()}
				actionVariant="destructive"
				isPending={cancelMutation.isPending}
				error={cancelMutation.error}
				onConfirm={() => {
					if (!cancelMutation.isPending) cancelMutation.mutate();
				}}
				onClose={() => setCancelOpen(false)}
			/>
		</div>
	);
}
