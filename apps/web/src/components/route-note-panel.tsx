import { MAX_ROUTE_NOTE_LENGTH_CHARS } from "@hack-the-andes-project/api/constants";
import {
	ROUTE_REVIEW_PLACES,
	type RouteReviewPlaceId,
} from "@hack-the-andes-project/business/route-review/places";
import { RouteNoteCard } from "@hack-the-andes-project/ui/components/route-note-card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatRouteReviewDateTime } from "@/lib/route-review-labels";
import {
	routeReviewClient,
	useRouteReviewQueries,
} from "@/lib/route-review-queries";
import { m } from "@/paraglide/messages";

interface RouteNotePanelProps {
	originPlaceId: RouteReviewPlaceId;
	destinationPlaceId: RouteReviewPlaceId;
}

export function RouteNotePanel({
	originPlaceId,
	destinationPlaceId,
}: RouteNotePanelProps) {
	const routeReviewQueries = useRouteReviewQueries();
	const queryClient = useQueryClient();
	const routeNoteQuery = useQuery({
		...routeReviewQueries.routeNote(originPlaceId, destinationPlaceId),
		meta: { silentError: true },
		retry: false,
	});
	const queryKey = routeReviewQueries.routeNote(
		originPlaceId,
		destinationPlaceId,
	).queryKey;
	const saveMutation = useMutation({
		mutationFn: (content: string) =>
			routeReviewClient.routeNotes.save({
				originPlaceId,
				destinationPlaceId,
				content,
				consent: true,
			}),
		onSuccess: async () => {
			toast.success(m.route_note_saved_toast());
			await queryClient.invalidateQueries({ queryKey });
		},
		onError: (error) => toast.error(error.message),
	});
	const removeMutation = useMutation({
		mutationFn: () =>
			routeReviewClient.routeNotes.remove({
				originPlaceId,
				destinationPlaceId,
			}),
		onSuccess: async () => {
			toast.success(m.route_note_removed_toast());
			await queryClient.invalidateQueries({ queryKey });
		},
		onError: (error) => toast.error(error.message),
	});
	const state = routeNoteQuery.isError
		? { status: "unavailable" as const }
		: routeNoteQuery.data;
	if (!state || state.status === "off") return null;
	return (
		<RouteNoteCard
			key={JSON.stringify(queryKey)}
			state={state}
			maxLength={MAX_ROUTE_NOTE_LENGTH_CHARS}
			isSaving={saveMutation.isPending}
			isRemoving={removeMutation.isPending}
			onSave={(content) => saveMutation.mutateAsync(content)}
			onRemove={() => removeMutation.mutate()}
			labels={{
				title: m.route_note_title(),
				description: m.route_note_description({
					route: `${ROUTE_REVIEW_PLACES[originPlaceId].name} → ${ROUTE_REVIEW_PLACES[destinationPlaceId].name}`,
				}),
				noteLabel: m.route_note_label(),
				placeholder: m.route_note_placeholder(),
				consent: m.route_note_consent(),
				save: m.route_note_save(),
				saving: m.saving(),
				correct: m.route_note_correct(),
				cancel: m.route_note_cancel(),
				remove: m.route_note_remove(),
				removing: m.route_note_removing(),
				unavailable: m.route_note_unavailable(),
				savedAt: (date) =>
					m.route_note_saved_at({ date: formatRouteReviewDateTime(date) }),
			}}
		/>
	);
}
