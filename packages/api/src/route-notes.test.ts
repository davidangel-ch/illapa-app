import { createRequire } from "node:module";
import { DEMO_ACCOUNT_EMAIL } from "@hack-the-andes-project/business/demo-account";
import { call } from "@orpc/server";
import { createRequestLogger } from "evlog";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	ROUTE_NOTE_MEMORY_OFF_MESSAGE,
	ROUTE_NOTE_NOT_REMOVED_MESSAGE,
	ROUTE_NOTE_NOT_SAVED_MESSAGE,
} from "./constants";
import type { Context } from "./context";
import { type AtomicMemoryConfig, parseAtomicMemorySetup } from "./route-notes";
import { appRouter } from "./routers/index";

const databaseRequire = createRequire(
	import.meta.resolve("@hack-the-andes-project/db"),
);
vi.doMock(databaseRequire.resolve("mysql2/promise"), () => ({
	default: {
		createConnection: vi.fn(async () => ({
			config: {},
			query: vi.fn(),
			end: vi.fn(),
		})),
	},
}));

const { createDb } = await import("@hack-the-andes-project/db");
const { createAuth } = await import("@hack-the-andes-project/auth");
const database = await createDb({
	host: "mock",
	port: Number.NaN,
	user: "mock",
	password: "mock",
	database: "mock",
});
const auth = createAuth(
	{
		BETTER_AUTH_URL: "https://api.example.com",
		BETTER_AUTH_SECRET: "test-secret-for-route-note-procedures",
		ALLOWED_ORIGINS: "https://app.example.com",
		CLIENT_IP_HEADER: "cf-connecting-ip",
	},
	database,
);
const createdAt = new Date("2026-10-17T00:00:00.000Z");
const limaToHuancayo = {
	originPlaceId: "lima",
	destinationPlaceId: "huancayo",
} as const;

function sessionFor({
	userId,
	email = `${userId}@example.com`,
	sessionId = `${userId}-session`,
}: {
	userId: string;
	email?: string;
	sessionId?: string;
}): NonNullable<Context["session"]> {
	return {
		user: {
			id: userId,
			name: userId,
			email,
			emailVerified: true,
			role: null,
			createdAt,
			updatedAt: createdAt,
		},
		session: {
			id: sessionId,
			userId,
			token: `${sessionId}-token`,
			createdAt,
			updatedAt: createdAt,
			expiresAt: new Date("2026-10-18T00:00:00.000Z"),
			activeOrganizationId: "fleet-organization",
		},
	};
}

function contextFor(
	session: NonNullable<Context["session"]>,
	atomicMemory?: AtomicMemoryConfig,
): Context {
	return {
		db: database,
		auth,
		log: createRequestLogger(),
		session,
		encryptionKey: "unused-in-route-note-tests",
		osrmBaseUrl: "https://routing.example.com",
		waitUntil: (promise) => void promise,
		atomicMemory,
	};
}

const ingestBodySchema = z.object({
	user_id: z.string(),
	conversation: z.string(),
	skip_extraction: z.literal(true),
	content_class: z.literal("summary"),
	metadata: z.object({ externalId: z.string(), savedAt: z.string() }),
});

// Test fixture for the documented Atomic Memory routes this feature calls; it
// is not the hosted service.
function createAtomicMemoryFixture({
	ingestStatus = 200,
	deleteKeepsRecord = false,
}: {
	ingestStatus?: number;
	deleteKeepsRecord?: boolean;
} = {}) {
	const records: Array<{
		id: string;
		userId: string;
		externalId: string;
		content: string;
		savedAt: string;
	}> = [];
	const requests: Array<{ url: URL; method: string; authorization: string }> =
		[];
	let nextId = 1;
	const fixtureFetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		requests.push({
			url,
			method,
			authorization: new Headers(init?.headers).get("authorization") ?? "",
		});
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(init?.redirect).toBe("error");
		if (url.pathname === "/v1/memories/ingest/quick") {
			const body = ingestBodySchema.parse(JSON.parse(String(init?.body)));
			const existing = records.find(
				(record) =>
					record.userId === body.user_id &&
					record.externalId === body.metadata.externalId,
			);
			if (existing) {
				existing.content = body.conversation;
				existing.savedAt = body.metadata.savedAt;
				return Response.json({
					stored_memory_ids: [],
					updated_memory_ids: [existing.id],
				});
			}
			const id = `memory-${nextId++}`;
			records.push({
				id,
				userId: body.user_id,
				externalId: body.metadata.externalId,
				content: body.conversation,
				savedAt: body.metadata.savedAt,
			});
			return Response.json(
				{ stored_memory_ids: [id], updated_memory_ids: [] },
				{ status: ingestStatus },
			);
		}
		const byExternalId = url.pathname.match(
			/^\/v1\/memories\/by-external-id\/([^/]+)$/,
		);
		if (method === "GET" && byExternalId) {
			const found = records.find(
				(record) =>
					record.userId === url.searchParams.get("user_id") &&
					record.externalId === decodeURIComponent(byExternalId[1] ?? ""),
			);
			return found
				? Response.json({
						id: found.id,
						content: found.content,
						metadata: { externalId: found.externalId, savedAt: found.savedAt },
					})
				: Response.json({ error: "Memory not found" }, { status: 404 });
		}
		const recordIndex = records.findIndex(
			(record) =>
				url.pathname === `/v1/memories/${record.id}` &&
				record.userId === url.searchParams.get("user_id"),
		);
		if (method === "DELETE" && recordIndex >= 0) {
			if (deleteKeepsRecord) return Response.json({ success: false });
			records.splice(recordIndex, 1);
			return Response.json({ success: true });
		}
		return Response.json({ error: "not_found" }, { status: 404 });
	};
	return {
		records,
		requests,
		config: {
			apiUrl: "https://memory.example.com",
			apiKey: "fixture-project-key",
			fetch: fixtureFetch,
		},
	};
}

const operator = sessionFor({ userId: "operator" });
const otherOperator = sessionFor({ userId: "other-operator" });

beforeEach(() => {
	vi.spyOn(database.query.member, "findFirst").mockResolvedValue({
		id: "membership",
		organizationId: "fleet-organization",
		userId: "operator",
		role: "member",
		createdAt,
	});
});

afterAll(async () => {
	vi.restoreAllMocks();
	await database.$client.end();
});

describe("route notes", () => {
	it("stays off and saves nothing without Atomic Memory configuration", async () => {
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, {
				context: contextFor(operator),
			}),
		).resolves.toEqual({ status: "off" });
		await expect(
			call(
				appRouter.routeNotes.save,
				{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: true },
				{ context: contextFor(operator) },
			),
		).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: ROUTE_NOTE_MEMORY_OFF_MESSAGE,
		});
	});

	it("requires the operator's explicit consent before saving", async () => {
		const atomicMemory = createAtomicMemoryFixture();
		await expect(
			call(
				appRouter.routeNotes.save,
				// @ts-expect-error The typed client cannot send this; the server must refuse it anyway.
				{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: false },
				{ context: contextFor(operator, atomicMemory.config) },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(atomicMemory.requests).toEqual([]);
	});

	it("recalls, corrects and removes the operator's note for one route", async () => {
		const atomicMemory = createAtomicMemoryFixture();
		const context = contextFor(operator, atomicMemory.config);
		await call(
			appRouter.routeNotes.save,
			{
				...limaToHuancayo,
				content: "Neblina en Ticlio antes de las 6:00",
				consent: true,
			},
			{ context },
		);
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, { context }),
		).resolves.toMatchObject({
			status: "ready",
			note: { content: "Neblina en Ticlio antes de las 6:00" },
		});
		await expect(
			call(
				appRouter.routeNotes.get,
				{ originPlaceId: "lima", destinationPlaceId: "tarma" },
				{ context },
			),
		).resolves.toEqual({ status: "ready", note: null });

		await call(
			appRouter.routeNotes.save,
			{
				...limaToHuancayo,
				content: "Neblina en Ticlio antes de las 7:00",
				consent: true,
			},
			{ context },
		);
		expect(atomicMemory.records).toHaveLength(1);
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, { context }),
		).resolves.toMatchObject({
			note: { content: "Neblina en Ticlio antes de las 7:00" },
		});

		await expect(
			call(appRouter.routeNotes.remove, limaToHuancayo, { context }),
		).resolves.toEqual({ removed: true });
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, { context }),
		).resolves.toEqual({ status: "ready", note: null });
		expect(atomicMemory.records).toEqual([]);
		expect(
			atomicMemory.requests.every(
				(request) =>
					request.url.origin === "https://memory.example.com" &&
					request.authorization === "Bearer fixture-project-key",
			),
		).toBe(true);
	});

	it("keeps each operator's notes, and each demo visitor's, apart", async () => {
		const atomicMemory = createAtomicMemoryFixture();
		await call(
			appRouter.routeNotes.save,
			{ ...limaToHuancayo, content: "Mi nota privada", consent: true },
			{ context: contextFor(operator, atomicMemory.config) },
		);
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, {
				context: contextFor(otherOperator, atomicMemory.config),
			}),
		).resolves.toEqual({ status: "ready", note: null });
		await expect(
			call(appRouter.routeNotes.remove, limaToHuancayo, {
				context: contextFor(otherOperator, atomicMemory.config),
			}),
		).resolves.toEqual({ removed: false });
		expect(atomicMemory.records).toHaveLength(1);

		const demoVisitor = sessionFor({
			userId: "demo-user",
			email: DEMO_ACCOUNT_EMAIL,
			sessionId: "first-visitor",
		});
		const nextDemoVisitor = sessionFor({
			userId: "demo-user",
			email: DEMO_ACCOUNT_EMAIL,
			sessionId: "next-visitor",
		});
		await call(
			appRouter.routeNotes.save,
			{ ...limaToHuancayo, content: "Nota de un visitante", consent: true },
			{ context: contextFor(demoVisitor, atomicMemory.config) },
		);
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, {
				context: contextFor(nextDemoVisitor, atomicMemory.config),
			}),
		).resolves.toEqual({ status: "ready", note: null });
		expect(atomicMemory.records.map((record) => record.userId)).toEqual([
			"illapa:fleet-organization:operator",
			"illapa-demo-session:first-visitor",
		]);
	});

	it("reports an unavailable provider honestly without leaking its error", async () => {
		const failingFetch = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ error: "upstream failure with fixture-project-key" },
				{ status: 503 },
			),
		);
		const context = contextFor(operator, {
			apiUrl: "https://memory.example.com",
			apiKey: "fixture-project-key",
			fetch: failingFetch,
		});
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, { context }),
		).resolves.toEqual({ status: "unavailable" });
		await expect(
			call(
				appRouter.routeNotes.save,
				{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: true },
				{ context },
			),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			message: ROUTE_NOTE_NOT_SAVED_MESSAGE,
		});
		await expect(
			call(appRouter.routeNotes.remove, limaToHuancayo, { context }),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			message: ROUTE_NOTE_NOT_REMOVED_MESSAGE,
		});
	});

	it("accepts a 201 save once the note reads back", async () => {
		const atomicMemory = createAtomicMemoryFixture({ ingestStatus: 201 });
		const context = contextFor(operator, atomicMemory.config);
		await expect(
			call(
				appRouter.routeNotes.save,
				{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: true },
				{ context },
			),
		).resolves.toMatchObject({ content: "Neblina en Ticlio" });
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, { context }),
		).resolves.toMatchObject({ note: { content: "Neblina en Ticlio" } });
	});

	it("does not claim a deletion while the note still reads back", async () => {
		const atomicMemory = createAtomicMemoryFixture({ deleteKeepsRecord: true });
		const context = contextFor(operator, atomicMemory.config);
		await call(
			appRouter.routeNotes.save,
			{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: true },
			{ context },
		);
		await expect(
			call(appRouter.routeNotes.remove, limaToHuancayo, { context }),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			message: ROUTE_NOTE_NOT_REMOVED_MESSAGE,
		});
		expect(atomicMemory.records).toHaveLength(1);
	});

	it("does not report a save that Atomic Memory did not confirm", async () => {
		const unconfirmedFetch = vi.fn<typeof fetch>(async (input) =>
			new URL(String(input)).pathname === "/v1/memories/ingest/quick"
				? Response.json({ stored_memory_ids: [], updated_memory_ids: [] })
				: Response.json({ error: "Memory not found" }, { status: 404 }),
		);
		await expect(
			call(
				appRouter.routeNotes.save,
				{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: true },
				{
					context: contextFor(operator, {
						apiUrl: "https://memory.example.com",
						apiKey: "fixture-project-key",
						fetch: unconfirmedFetch,
					}),
				},
			),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			message: ROUTE_NOTE_NOT_SAVED_MESSAGE,
		});
	});

	it("shows a malformed lookup as unavailable, not as no note", async () => {
		const context = contextFor(operator, {
			apiUrl: "https://memory.example.com",
			apiKey: "fixture-project-key",
			fetch: async () => Response.json({ unexpected: true }),
		});
		await expect(
			call(appRouter.routeNotes.get, limaToHuancayo, { context }),
		).resolves.toEqual({ status: "unavailable" });
	});

	it("treats a timed-out write as unconfirmed", async () => {
		const context = contextFor(operator, {
			apiUrl: "https://memory.example.com",
			apiKey: "fixture-project-key",
			fetch: (_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason),
					);
					setTimeout(
						() =>
							reject(
								new DOMException("The operation timed out.", "TimeoutError"),
							),
						0,
					);
				}),
		});
		await expect(
			call(
				appRouter.routeNotes.save,
				{ ...limaToHuancayo, content: "Neblina en Ticlio", consent: true },
				{ context },
			),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			message: ROUTE_NOTE_NOT_SAVED_MESSAGE,
		});
	});
});

describe("Atomic Memory setup", () => {
	it("stays off when neither value is set", () => {
		expect(
			parseAtomicMemorySetup({ apiUrl: undefined, apiKey: undefined }),
		).toEqual({ status: "off" });
	});

	it("accepts HTTPS, and plain HTTP only on loopback", () => {
		expect(
			parseAtomicMemorySetup({
				apiUrl: "https://api.atomicstrata.ai/",
				apiKey: "key",
			}),
		).toEqual({
			status: "on",
			config: { apiUrl: "https://api.atomicstrata.ai", apiKey: "key" },
		});
		expect(
			parseAtomicMemorySetup({
				apiUrl: "http://127.0.0.1:17350",
				apiKey: "key",
			}),
		).toMatchObject({ status: "on" });
	});

	it.each([
		["http://memory.example.com", "key"],
		["https://user:secret@memory.example.com", "key"],
		["https://memory.example.com?token=1", "key"],
		["https://memory.example.com#fragment", "key"],
		["not a url", "key"],
		["https://memory.example.com", undefined],
	])("turns notes off for %s", (apiUrl, apiKey) => {
		expect(parseAtomicMemorySetup({ apiUrl, apiKey })).toMatchObject({
			status: "invalid",
		});
	});
});
