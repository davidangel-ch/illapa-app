import { isDemoAccountEmail } from "@hack-the-andes-project/business/demo-account";
import { ROUTE_REVIEW_PLACE_IDS } from "@hack-the-andes-project/business/route-review/places";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
	MAX_ROUTE_NOTE_LENGTH_CHARS,
	ROUTE_NOTE_MEMORY_OFF_MESSAGE,
	ROUTE_NOTE_NOT_REMOVED_MESSAGE,
	ROUTE_NOTE_NOT_SAVED_MESSAGE,
} from "../constants";
import type { OrganizationContext } from "../context";
import { organizationProcedure } from "../index";
import {
	findRouteNote,
	type RouteNoteKey,
	removeRouteNote,
	saveRouteNote,
} from "../route-notes";

const routeNoteInputSchema = z.object({
	originPlaceId: z.enum(ROUTE_REVIEW_PLACE_IDS),
	destinationPlaceId: z.enum(ROUTE_REVIEW_PLACE_IDS),
});

const routeNoteSchema = z.object({
	content: z.string(),
	savedAt: z.date().nullable(),
});

export const routeNoteStateSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("off") }),
	z.object({ status: z.literal("unavailable") }),
	z.object({ status: z.literal("ready"), note: routeNoteSchema.nullable() }),
]);
export type RouteNoteState = z.infer<typeof routeNoteStateSchema>;

// The shared demo account is one user for every visitor, so its notes live
// under the visitor's own session and never reach the next visitor.
function routeNoteKey(
	context: Pick<OrganizationContext, "organizationId"> & {
		session: NonNullable<OrganizationContext["session"]>;
	},
	input: z.infer<typeof routeNoteInputSchema>,
): RouteNoteKey {
	return {
		subject: isDemoAccountEmail(context.session.user.email)
			? `illapa-demo-session:${context.session.session.id}`
			: `illapa:${context.organizationId}:${context.session.user.id}`,
		...input,
	};
}

function requireAtomicMemory(context: OrganizationContext) {
	if (!context.atomicMemory)
		throw new ORPCError("PRECONDITION_FAILED", {
			message: ROUTE_NOTE_MEMORY_OFF_MESSAGE,
		});
	return context.atomicMemory;
}

export const routeNotesRouter = {
	get: organizationProcedure
		.input(routeNoteInputSchema)
		.output(routeNoteStateSchema)
		.handler(async ({ context, input }): Promise<RouteNoteState> => {
			if (!context.atomicMemory) return { status: "off" };
			try {
				const note = await findRouteNote(
					context.atomicMemory,
					routeNoteKey(context, input),
				);
				context.log.set({
					routeNotes: { action: "get", found: Boolean(note) },
				});
				return {
					status: "ready",
					note: note ? { content: note.content, savedAt: note.savedAt } : null,
				};
			} catch (error) {
				context.log.set({
					routeNotes: {
						action: "get",
						error: error instanceof Error ? error.message : "Error",
					},
				});
				return { status: "unavailable" };
			}
		}),
	save: organizationProcedure
		.input(
			routeNoteInputSchema.extend({
				content: z.string().trim().min(1).max(MAX_ROUTE_NOTE_LENGTH_CHARS),
				consent: z.literal(true),
			}),
		)
		.output(routeNoteSchema)
		.handler(async ({ context, input }) => {
			const atomicMemory = requireAtomicMemory(context);
			const savedNote = await saveRouteNote(
				atomicMemory,
				routeNoteKey(context, input),
				input.content,
			).catch((error: unknown) => {
				context.log.set({
					routeNotes: {
						action: "save",
						error: error instanceof Error ? error.message : "Error",
					},
				});
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: ROUTE_NOTE_NOT_SAVED_MESSAGE,
				});
			});
			context.log.set({ routeNotes: { action: "save" } });
			return { content: savedNote.content, savedAt: savedNote.savedAt };
		}),
	remove: organizationProcedure
		.input(routeNoteInputSchema)
		.output(z.object({ removed: z.boolean() }))
		.handler(async ({ context, input }) => {
			const atomicMemory = requireAtomicMemory(context);
			const removed = await removeRouteNote(
				atomicMemory,
				routeNoteKey(context, input),
			).catch((error: unknown) => {
				context.log.set({
					routeNotes: {
						action: "remove",
						error: error instanceof Error ? error.message : "Error",
					},
				});
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: ROUTE_NOTE_NOT_REMOVED_MESSAGE,
				});
			});
			context.log.set({ routeNotes: { action: "remove", removed } });
			return { removed };
		}),
};
