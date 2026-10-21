import {
	SAME_ORIGIN_AND_DESTINATION_MESSAGE,
	VEHICLE_PROFILE_REQUIRED_MESSAGE,
} from "@hack-the-andes-project/api/constants";
import type {
	ProfiledVehicleSummary,
	RouteReview,
	RouteReviewInput,
	TripPlanInput,
} from "@hack-the-andes-project/api/route-review-schemas";
import { ROUTE_REVIEW_DEPARTURE_WINDOW_MS } from "@hack-the-andes-project/business/constants";
import {
	ROUTE_REVIEW_PLACE_IDS,
	ROUTE_REVIEW_PLACES,
	type RouteReviewPlaceId,
} from "@hack-the-andes-project/business/route-review/places";
import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import { isDepartureInReviewWindow } from "@hack-the-andes-project/business/route-review/trips";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@hack-the-andes-project/ui/components/alert";
import { Button } from "@hack-the-andes-project/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@hack-the-andes-project/ui/components/empty";
import { RouteReviewCandidateSkeleton } from "@hack-the-andes-project/ui/components/route-review-candidate-card";
import { RouteReviewCandidateList } from "@hack-the-andes-project/ui/components/route-review-candidate-list";
import { RouteReviewForm } from "@hack-the-andes-project/ui/components/route-review-form";
import { RouteReviewHorizonToggle } from "@hack-the-andes-project/ui/components/route-review-horizon-toggle";
import { RouteReviewMap } from "@hack-the-andes-project/ui/components/route-review-map";
import { Spinner } from "@hack-the-andes-project/ui/components/spinner";
import { VehicleProfileDialog } from "@hack-the-andes-project/ui/components/vehicle-profile-dialog";
import {
	type RouteReviewFormValue,
	vehicleTypeShortLabel,
} from "@hack-the-andes-project/ui/lib/route-review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { RouteNotePanel } from "@/components/route-note-panel";
import {
	ROUTE_REVIEW_DEPARTURE_LEAD_MS,
	ROUTE_REVIEW_DEPARTURE_STEP_MS,
	ROUTE_REVIEW_LAST_VEHICLE_KEY,
	ROUTE_REVIEW_MAP_CASING_WIDTH_PX,
	ROUTE_REVIEW_MAP_COMPACT_HEIGHT_PX,
	ROUTE_REVIEW_MAP_COMPACT_LEGEND_PADDING_PX,
	ROUTE_REVIEW_MAP_FIT_PADDING_PX,
	ROUTE_REVIEW_MAP_LEGEND_PADDING_PX,
	ROUTE_REVIEW_MAP_LINE_WIDTH_PX,
	ROUTE_REVIEW_MAP_SELECTED_WIDTH_PX,
	ROUTE_REVIEW_TIME_OFFSET,
} from "@/constants";
import {
	formatRouteReviewDateTime,
	formatRouteReviewLocalInput,
	getRouteReviewLabels,
} from "@/lib/route-review-labels";
import {
	invalidateRouteReviewQueries,
	routeReviewClient,
	useRouteReviewQueries,
} from "@/lib/route-review-queries";
import {
	getVehicleProfileDialogLabels,
	getVehicleTypeLabels,
	useSaveVehicleProfile,
} from "@/lib/vehicle-profile";
import { m } from "@/paraglide/messages";

interface ReviewSearch {
	origen?: RouteReviewPlaceId;
	destino?: RouteReviewPlaceId;
	vehiculo?: string;
}
interface ReviewRequest {
	input: RouteReviewInput;
	form: RouteReviewFormValue;
}
interface ReviewValidation {
	destination?: string;
	departure?: string;
	vehicle?: string;
}
export const Route = createFileRoute("/_auth/dashboard/revisar-ruta")({
	validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
		origen: ROUTE_REVIEW_PLACE_IDS.find((place) => place === search.origen),
		destino: ROUTE_REVIEW_PLACE_IDS.find((place) => place === search.destino),
		vehiculo: typeof search.vehiculo === "string" ? search.vehiculo : undefined,
	}),
	component: RouteReviewPage,
});
const places = ROUTE_REVIEW_PLACE_IDS.map((id) => ({
	id,
	...ROUTE_REVIEW_PLACES[id],
}));
function RouteReviewPage() {
	const routeReviewQueries = useRouteReviewQueries();
	const search = Route.useSearch();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const vehiclesQuery = useQuery(routeReviewQueries.vehicles);
	const [value, setValue] = useState<RouteReviewFormValue>(() => {
		let vehicleId = search.vehiculo ?? "";
		if (!vehicleId) {
			try {
				vehicleId = localStorage.getItem(ROUTE_REVIEW_LAST_VEHICLE_KEY) ?? "";
			} catch {
				vehicleId = "";
			}
		}
		return {
			originPlaceId: search.origen ?? "lima",
			destinationPlaceId: search.destino ?? "huancayo",
			vehicleId,
			departureLocal: formatRouteReviewLocalInput(
				new Date(
					Math.ceil(
						(Date.now() + ROUTE_REVIEW_DEPARTURE_LEAD_MS) /
							ROUTE_REVIEW_DEPARTURE_STEP_MS,
					) * ROUTE_REVIEW_DEPARTURE_STEP_MS,
				),
			),
		};
	});
	const [departureExpired, setDepartureExpired] = useState(false);
	const [review, setReview] = useState<RouteReview | null>(null);
	const [reviewedForm, setReviewedForm] = useState<RouteReviewFormValue | null>(
		null,
	);
	const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
		null,
	);
	const [horizon, setHorizon] = useState<RouteRiskHorizon>("now");
	const [collapsed, setCollapsed] = useState(false);
	const [validation, setValidation] = useState<ReviewValidation>({});
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogVehicle, setDialogVehicle] =
		useState<ProfiledVehicleSummary | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const resultsRef = useRef<HTMLHeadingElement>(null);
	const errorRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<HTMLDivElement>(null);
	const vehicleInputId = useId();
	const [labels] = useState(getRouteReviewLabels);
	const vehicle = vehiclesQuery.data?.find(
		(vehicle) => vehicle.id === value.vehicleId,
	);
	const reviewedVehicle = vehiclesQuery.data?.find(
		(vehicle) => vehicle.id === review?.vehicleId,
	);
	const vehicleTypeLabels = getVehicleTypeLabels();
	const stale =
		departureExpired ||
		Boolean(
			reviewedForm &&
				(reviewedForm.originPlaceId !== value.originPlaceId ||
					reviewedForm.destinationPlaceId !== value.destinationPlaceId ||
					reviewedForm.vehicleId !== value.vehicleId ||
					reviewedForm.departureLocal !== value.departureLocal ||
					review?.vehicleAxleCount !== vehicle?.profile?.axleCount),
		);
	const evaluateMutation = useMutation({
		mutationFn: ({ input }: ReviewRequest) =>
			routeReviewClient.routeReview.evaluate(input),
		onSuccess: (result, request) => {
			setReview(result);
			setDepartureExpired(false);
			setReviewedForm(request.form);
			setSelectedCandidateId(result.recommendedCandidateId);
			setCollapsed(true);
			setAnnouncement(
				(result.candidates.length === 1
					? m.route_review_results_one
					: m.route_review_results)({
					count: result.candidates.length,
					vehicle: vehicle?.name ?? "",
					axles: result.vehicleAxleCount,
				}),
			);
			try {
				localStorage.setItem(ROUTE_REVIEW_LAST_VEHICLE_KEY, result.vehicleId);
			} catch {
				return;
			}
		},
		onError: (error) => {
			if (error.message === VEHICLE_PROFILE_REQUIRED_MESSAGE)
				setValidation({ vehicle: error.message });
			setCollapsed(false);
		},
	});
	const planMutation = useMutation({
		mutationFn: (input: TripPlanInput) => routeReviewClient.trips.plan(input),
		onSuccess: async (trip) => {
			await invalidateRouteReviewQueries(queryClient);
			toast.success(m.route_review_planned_toast({ name: trip.name }));
			await navigate({
				to: "/dashboard/fleet/viajes/$tripId",
				params: { tripId: trip.id },
			});
		},
		onError: (error) => toast.error(error.message),
	});
	const saveVehicleMutation = useSaveVehicleProfile({
		vehicle: dialogVehicle,
		onSaved: (updated) => {
			setValue((current) => ({ ...current, vehicleId: updated.id }));
			setValidation({});
		},
	});
	useEffect(() => {
		if (review) resultsRef.current?.focus();
	}, [review]);
	useEffect(() => {
		if (evaluateMutation.isError) {
			if (evaluateMutation.error.message === VEHICLE_PROFILE_REQUIRED_MESSAGE)
				document.getElementById(vehicleInputId)?.focus();
			else errorRef.current?.focus();
		}
	}, [evaluateMutation.isError, evaluateMutation.error, vehicleInputId]);
	const submitReview = (formValue = value) => {
		if (evaluateMutation.isPending || planMutation.isPending) return;
		const now = new Date();
		const departureAt = new Date(
			`${formValue.departureLocal}:00${ROUTE_REVIEW_TIME_OFFSET}`,
		);
		const errors: ReviewValidation = {};
		if (formValue.originPlaceId === formValue.destinationPlaceId)
			errors.destination = SAME_ORIGIN_AND_DESTINATION_MESSAGE;
		if (!isDepartureInReviewWindow(departureAt, now))
			errors.departure = m.route_review_departure_error();
		if (!vehicle?.profile) errors.vehicle = VEHICLE_PROFILE_REQUIRED_MESSAGE;
		setValidation(errors);
		if (Object.keys(errors).length) {
			setCollapsed(false);
			return;
		}
		const form = {
			...formValue,
			departureLocal: formatRouteReviewLocalInput(departureAt),
		};
		setValue(form);
		evaluateMutation.mutate({
			input: {
				originPlaceId: form.originPlaceId,
				destinationPlaceId: form.destinationPlaceId,
				vehicleId: form.vehicleId,
				departureAt,
			},
			form,
		});
	};
	const origin =
		ROUTE_REVIEW_PLACES[review?.originPlaceId ?? value.originPlaceId];
	const destination =
		ROUTE_REVIEW_PLACES[review?.destinationPlaceId ?? value.destinationPlaceId];
	return (
		<div className="flex min-h-0 flex-1 flex-col xl:flex-row">
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			<div className="contents xl:flex xl:w-100 xl:shrink-0 xl:flex-col xl:overflow-y-auto xl:border-r">
				<div className="order-1">
					<RouteReviewForm
						places={places}
						vehicles={(vehiclesQuery.data ?? []).map((vehicle) => ({
							id: vehicle.id,
							name: vehicle.name,
							plate: vehicle.plate,
							typeLabel: vehicle.profile
								? vehicleTypeShortLabel(
										vehicle.profile.vehicleTypeId,
										vehicleTypeLabels,
									)
								: null,
							axleCount: vehicle.profile?.axleCount ?? null,
						}))}
						value={value}
						onValueChange={(next) => {
							setValue(next);
							setValidation({});
						}}
						onSubmit={submitReview}
						onAddVehicle={() => {
							setDialogVehicle(null);
							setDialogOpen(true);
						}}
						onSetVehicleType={() => {
							if (vehicle) {
								setDialogVehicle(vehicle);
								setDialogOpen(true);
							}
						}}
						departureWindow={{
							min: formatRouteReviewLocalInput(new Date()),
							max: formatRouteReviewLocalInput(
								new Date(Date.now() + ROUTE_REVIEW_DEPARTURE_WINDOW_MS),
							),
						}}
						isReviewing={evaluateMutation.isPending}
						isDisabled={
							evaluateMutation.isPending ||
							planMutation.isPending ||
							vehiclesQuery.isPending
						}
						error={validation}
						collapsed={collapsed}
						onExpand={() => setCollapsed(false)}
						labels={labels}
						summary={`${ROUTE_REVIEW_PLACES[value.originPlaceId].name} → ${ROUTE_REVIEW_PLACES[value.destinationPlaceId].name} · ${vehicle?.name ?? ""} · ${value.departureLocal ? labels.dateTime(new Date(`${value.departureLocal}:00${ROUTE_REVIEW_TIME_OFFSET}`)) : ""}`}
						vehicleInputId={vehicleInputId}
					/>
				</div>
				<div className="order-3 flex flex-col gap-4 p-4">
					{value.originPlaceId !== value.destinationPlaceId ? (
						<RouteNotePanel
							originPlaceId={value.originPlaceId}
							destinationPlaceId={value.destinationPlaceId}
						/>
					) : null}
					{vehiclesQuery.isError ? (
						<Alert variant="destructive">
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
					{evaluateMutation.isError &&
					evaluateMutation.error.message !==
						VEHICLE_PROFILE_REQUIRED_MESSAGE ? (
						<Alert ref={errorRef} tabIndex={-1} variant="destructive">
							<AlertTitle>{m.route_review_error_title()}</AlertTitle>
							<AlertDescription>
								{m.route_review_error_description()}
								<Button variant="outline" onClick={() => submitReview()}>
									{m.query_retry()}
								</Button>
							</AlertDescription>
						</Alert>
					) : null}
					{review ? (
						<>
							<div className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background py-3">
								<h2
									ref={resultsRef}
									tabIndex={-1}
									className="type-heading outline-none"
								>
									{(review.candidates.length === 1
										? m.route_review_results_one
										: m.route_review_results)({
										count: review.candidates.length,
										vehicle: reviewedVehicle?.name ?? "",
										axles: review.vehicleAxleCount,
									})}
								</h2>
								<p className="type-data">
									{labels.evaluated}{" "}
									<time dateTime={review.evaluatedAt.toISOString()}>
										{labels.observedAt(review.evaluatedAt)}
									</time>
								</p>
								<RouteReviewHorizonToggle
									horizons={review.horizons}
									value={horizon}
									onValueChange={setHorizon}
									labels={labels}
								/>
								{stale ? (
									<Alert>
										<AlertDescription>
											{m.route_review_stale()}
											<Button
												variant="outline"
												className="min-h-11"
												disabled={evaluateMutation.isPending}
												onClick={() => submitReview()}
											>
												{m.route_review_review_again()}
											</Button>
										</AlertDescription>
									</Alert>
								) : null}
								{evaluateMutation.isPending ? (
									<div
										role="status"
										className="flex items-center gap-2 border-primary border-t-2 pt-2"
									>
										<Spinner />
										{labels.reviewing}
									</div>
								) : null}
							</div>
							{review.candidates.length === 0 ? (
								<Empty>
									<EmptyHeader>
										<EmptyTitle>
											{m.route_review_empty_title({
												origin: origin.name,
												destination: destination.name,
											})}
										</EmptyTitle>
										<EmptyDescription>
											{m.route_review_empty_description()}
										</EmptyDescription>
									</EmptyHeader>
									<Button
										variant="outline"
										className="min-h-11"
										onClick={() => {
											submitReview({
												...value,
												originPlaceId: "lima",
												destinationPlaceId: "huancayo",
											});
										}}
									>
										{m.route_review_reset_pair()}
									</Button>
								</Empty>
							) : (
								<>
									{!review.recommendedCandidateId ? (
										<Alert>
											<AlertTitle>
												{m.route_review_no_eligible({
													axles: review.vehicleAxleCount,
												})}
											</AlertTitle>
											<AlertDescription>
												{m.route_review_no_eligible_description()}
											</AlertDescription>
										</Alert>
									) : null}
									<RouteReviewCandidateList
										candidates={review.candidates}
										recommendedCandidateId={review.recommendedCandidateId}
										vehicleAxleCount={review.vehicleAxleCount}
										horizon={horizon}
										selectedCandidateId={selectedCandidateId}
										onSelect={setSelectedCandidateId}
										onViewMap={(id) => {
											setSelectedCandidateId(id);
											mapRef.current?.scrollIntoView({ block: "start" });
										}}
										isBusy={
											evaluateMutation.isPending || planMutation.isPending
										}
										labels={labels}
										renderAction={(candidate) =>
											stale ? null : (
												<Button
													disabled={
														planMutation.isPending || evaluateMutation.isPending
													}
													onClick={() => {
														if (
															!isDepartureInReviewWindow(
																review.departureAt,
																new Date(),
															)
														) {
															setDepartureExpired(true);
															setCollapsed(false);
															resultsRef.current?.focus();
															return;
														}
														planMutation.mutate({
															reviewId: review.id,
															candidateId: candidate.id,
															name: `${origin.name} → ${destination.name} · ${formatRouteReviewDateTime(review.departureAt)}`,
														});
													}}
												>
													{planMutation.isPending ? (
														<Spinner data-icon="inline-start" />
													) : null}
													{planMutation.isPending
														? m.saving()
														: labels.planTrip}
												</Button>
											)
										}
									/>
								</>
							)}
						</>
					) : evaluateMutation.isPending || vehiclesQuery.isPending ? (
						<output
							aria-label={
								vehiclesQuery.isPending
									? m.route_review_vehicles_loading()
									: labels.reviewing
							}
							aria-busy="true"
							className="flex flex-col gap-3"
						>
							<RouteReviewCandidateSkeleton />
							<RouteReviewCandidateSkeleton />
							<RouteReviewCandidateSkeleton />
						</output>
					) : vehiclesQuery.data?.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>{m.route_review_no_vehicles()}</EmptyTitle>
							</EmptyHeader>
							<Button
								className="min-h-11"
								onClick={() => {
									setDialogVehicle(null);
									setDialogOpen(true);
								}}
							>
								{labels.addVehicle}
							</Button>
						</Empty>
					) : (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>
									{vehicle
										? m.route_review_initial_ready_title()
										: m.route_review_initial_title()}
								</EmptyTitle>
								<EmptyDescription>
									{m.route_review_initial_description()}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</div>
			</div>
			<div
				ref={mapRef}
				className="order-2 h-60 shrink-0 px-4 xl:h-auto xl:min-h-0 xl:min-w-0 xl:flex-1 xl:p-4"
			>
				<RouteReviewMap
					candidates={review?.candidates ?? []}
					selectedCandidateId={selectedCandidateId}
					horizon={horizon}
					origin={origin}
					destination={destination}
					onSelectCandidate={(id) => {
						setSelectedCandidateId(id);
						document
							.getElementById(`route-review-candidate-${id}`)
							?.scrollIntoView({ block: "nearest" });
					}}
					labels={labels}
					className="h-full"
					isBusy={evaluateMutation.isPending}
					vehicleAxleCount={
						review?.vehicleAxleCount ?? vehicle?.profile?.axleCount
					}
					vehicleName={vehicle?.name}
					lineWidthPx={ROUTE_REVIEW_MAP_LINE_WIDTH_PX}
					selectedLineWidthPx={ROUTE_REVIEW_MAP_SELECTED_WIDTH_PX}
					casingWidthPx={ROUTE_REVIEW_MAP_CASING_WIDTH_PX}
					fitPaddingPx={ROUTE_REVIEW_MAP_FIT_PADDING_PX}
					legendPaddingPx={ROUTE_REVIEW_MAP_LEGEND_PADDING_PX}
					compactLegendPaddingPx={ROUTE_REVIEW_MAP_COMPACT_LEGEND_PADDING_PX}
					compactHeightPx={ROUTE_REVIEW_MAP_COMPACT_HEIGHT_PX}
				/>
			</div>
			<VehicleProfileDialog
				open={dialogOpen}
				onOpenChange={(open) => {
					setDialogOpen(open);
					if (!open)
						requestAnimationFrame(() =>
							document.getElementById(vehicleInputId)?.focus(),
						);
				}}
				vehicle={dialogVehicle}
				isPending={saveVehicleMutation.isPending}
				onSubmit={(draft) => saveVehicleMutation.mutateAsync(draft)}
				vehicleTypeLabels={vehicleTypeLabels}
				labels={getVehicleProfileDialogLabels()}
			/>
		</div>
	);
}
