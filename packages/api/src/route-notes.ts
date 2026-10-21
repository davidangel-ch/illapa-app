import {
	ROUTE_REVIEW_PLACES,
	type RouteReviewPlaceId,
} from "@hack-the-andes-project/business/route-review/places";
import { z } from "zod";

import {
	HTTP_STATUS_NOT_FOUND,
	ROUTE_NOTE_MEMORY_TIMEOUT_MS,
} from "./constants";

export interface AtomicMemoryConfig {
	apiUrl: string;
	apiKey: string;
	fetch?: typeof fetch;
}

export interface RouteNoteKey {
	subject: string;
	originPlaceId: RouteReviewPlaceId;
	destinationPlaceId: RouteReviewPlaceId;
}

export interface RouteNote {
	id: string;
	content: string;
	savedAt: Date | null;
}

export type AtomicMemorySetup =
	| { status: "off" }
	| { status: "invalid"; reason: string }
	| { status: "on"; config: AtomicMemoryConfig };

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// The API key travels with every request, so the provider URL must be HTTPS
// (plain HTTP only on loopback for a local Core) and carry nothing a key could
// leak through. A bad value turns route notes off; it never stops the server.
export function parseAtomicMemorySetup({
	apiUrl,
	apiKey,
}: {
	apiUrl: string | undefined;
	apiKey: string | undefined;
}): AtomicMemorySetup {
	if (!apiUrl && !apiKey) return { status: "off" };
	if (!apiUrl || !apiKey) return { status: "invalid", reason: "Incomplete" };
	if (!URL.canParse(apiUrl)) return { status: "invalid", reason: "InvalidUrl" };
	const url = new URL(apiUrl);
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname))
	)
		return { status: "invalid", reason: "InsecureUrl" };
	if (url.username || url.password || url.search || url.hash)
		return { status: "invalid", reason: "UnexpectedUrlParts" };
	return {
		status: "on",
		config: {
			apiUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}`,
			apiKey,
		},
	};
}

export class AtomicMemoryRequestError extends Error {
	override name = "AtomicMemoryRequestError";
}

const memoryRecordSchema = z.object({
	id: z.string().min(1),
	content: z.string(),
	created_at: z.coerce.date().optional(),
	metadata: z.object({ savedAt: z.coerce.date().optional() }).nullish(),
});

const ingestResponseSchema = z.object({
	stored_memory_ids: z.array(z.string()),
	updated_memory_ids: z.array(z.string()).default([]),
});

function routeNotePrefix(key: RouteNoteKey) {
	return `Nota revisada del operador para la ruta ${ROUTE_REVIEW_PLACES[key.originPlaceId].name} → ${ROUTE_REVIEW_PLACES[key.destinationPlaceId].name}: `;
}

function routeNoteExternalId(key: RouteNoteKey) {
	return `illapa-route-note:${key.subject}:${key.originPlaceId}:${key.destinationPlaceId}`;
}

// One signal per operation, so a save plus its readback, or a lookup plus its
// delete, share a single time budget instead of each request getting its own.
async function requestAtomicMemory({
	config,
	path,
	init,
	signal,
}: {
	config: AtomicMemoryConfig;
	path: string;
	init: RequestInit;
	signal: AbortSignal;
}) {
	return await (config.fetch ?? fetch)(`${config.apiUrl}/v1${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
		},
		redirect: "error",
		signal,
	}).catch((cause: unknown) => {
		// Only the error class leaves this module: transport messages can echo
		// the provider URL.
		throw new AtomicMemoryRequestError(
			cause instanceof Error ? cause.name : "Error",
		);
	});
}

async function readJson(response: Response) {
	return await response.json().catch(() => {
		throw new AtomicMemoryRequestError("InvalidResponse");
	});
}

// A 404 is the only "no note" answer; any other failure or an unexpected body
// is reported as unavailable, never as an empty note.
async function lookUpRouteNote(
	config: AtomicMemoryConfig,
	key: RouteNoteKey,
	signal: AbortSignal,
): Promise<RouteNote | null> {
	const response = await requestAtomicMemory({
		config,
		path: `/memories/by-external-id/${encodeURIComponent(routeNoteExternalId(key))}?user_id=${encodeURIComponent(key.subject)}`,
		init: { method: "GET" },
		signal,
	});
	if (response.status === HTTP_STATUS_NOT_FOUND) return null;
	if (!response.ok)
		throw new AtomicMemoryRequestError(`HTTP ${response.status}`);
	const parsed = memoryRecordSchema.safeParse(await readJson(response));
	if (!parsed.success) throw new AtomicMemoryRequestError("InvalidResponse");
	const prefix = routeNotePrefix(key);
	if (!parsed.data.content.startsWith(prefix))
		throw new AtomicMemoryRequestError("UnexpectedRecord");
	return {
		id: parsed.data.id,
		content: parsed.data.content.slice(prefix.length),
		savedAt: parsed.data.metadata?.savedAt ?? parsed.data.created_at ?? null,
	};
}

export async function findRouteNote(
	config: AtomicMemoryConfig,
	key: RouteNoteKey,
) {
	return await lookUpRouteNote(
		config,
		key,
		AbortSignal.timeout(ROUTE_NOTE_MEMORY_TIMEOUT_MS),
	);
}

// Success only once Atomic Memory reports the record it stored or updated and
// the same text reads back under the route's external id: a bare 200 does not
// prove what the operator will see next time.
export async function saveRouteNote(
	config: AtomicMemoryConfig,
	key: RouteNoteKey,
	content: string,
) {
	const signal = AbortSignal.timeout(ROUTE_NOTE_MEMORY_TIMEOUT_MS);
	const response = await requestAtomicMemory({
		config,
		path: "/memories/ingest/quick",
		init: {
			method: "POST",
			body: JSON.stringify({
				user_id: key.subject,
				conversation: `${routeNotePrefix(key)}${content}`,
				source_site: "illapa",
				source_url: "",
				skip_extraction: true,
				content_class: "summary",
				metadata: {
					externalId: routeNoteExternalId(key),
					savedAt: new Date().toISOString(),
				},
			}),
		},
		signal,
	});
	if (!response.ok)
		throw new AtomicMemoryRequestError(`HTTP ${response.status}`);
	const ingested = ingestResponseSchema.safeParse(await readJson(response));
	if (!ingested.success) throw new AtomicMemoryRequestError("InvalidResponse");
	const confirmedIds = [
		...ingested.data.stored_memory_ids,
		...ingested.data.updated_memory_ids,
	];
	const storedNote = await lookUpRouteNote(config, key, signal);
	if (
		!storedNote ||
		storedNote.content !== content ||
		!confirmedIds.includes(storedNote.id)
	)
		throw new AtomicMemoryRequestError("Unconfirmed");
	return storedNote;
}

export async function removeRouteNote(
	config: AtomicMemoryConfig,
	key: RouteNoteKey,
) {
	const signal = AbortSignal.timeout(ROUTE_NOTE_MEMORY_TIMEOUT_MS);
	const note = await lookUpRouteNote(config, key, signal);
	if (!note) return false;
	const response = await requestAtomicMemory({
		config,
		path: `/memories/${encodeURIComponent(note.id)}?user_id=${encodeURIComponent(key.subject)}`,
		init: { method: "DELETE" },
		signal,
	});
	// A 404 here means the record is already gone, which is what was asked.
	if (!response.ok && response.status !== HTTP_STATUS_NOT_FOUND)
		throw new AtomicMemoryRequestError(`HTTP ${response.status}`);
	if (await lookUpRouteNote(config, key, signal))
		throw new AtomicMemoryRequestError("StillPresent");
	return true;
}
