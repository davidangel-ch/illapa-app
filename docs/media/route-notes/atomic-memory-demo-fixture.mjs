// DEMO FIXTURE, not Atomic Memory Cloud. Implements only the documented
// routes Illapa's route notes call, in memory, on 127.0.0.1.
import { createServer } from "node:http";

const port = Number(process.env.FIXTURE_PORT ?? 4716);
const token = process.env.FIXTURE_TOKEN ?? "local-fixture-token";
const records = [];
let nextId = 1;

function send(response, status, body) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
	const url = new URL(request.url, `http://127.0.0.1:${port}`);
	if (request.headers.authorization !== `Bearer ${token}`)
		return send(response, 401, { error: "unauthorized" });
	let raw = "";
	for await (const chunk of request) raw += chunk;
	const body = raw ? JSON.parse(raw) : {};
	console.log(`[fixture] ${request.method} ${url.pathname}`);
	if (request.method === "POST" && url.pathname === "/v1/memories/ingest/quick") {
		const externalId = body.metadata?.externalId;
		const existing = records.find(
			(record) => record.user_id === body.user_id && record.externalId === externalId,
		);
		if (existing) {
			existing.content = body.conversation;
			existing.savedAt = body.metadata?.savedAt;
			return send(response, 200, { stored_memory_ids: [], updated_memory_ids: [existing.id] });
		}
		const id = `fixture-${nextId++}`;
		records.push({
			id,
			user_id: body.user_id,
			externalId,
			content: body.conversation,
			savedAt: body.metadata?.savedAt,
			created_at: new Date().toISOString(),
		});
		return send(response, 200, { stored_memory_ids: [id], updated_memory_ids: [] });
	}
	const byExternalId = url.pathname.match(/^\/v1\/memories\/by-external-id\/([^/]+)$/);
	if (request.method === "GET" && byExternalId) {
		const found = records.find(
			(record) =>
				record.user_id === url.searchParams.get("user_id") &&
				record.externalId === decodeURIComponent(byExternalId[1]),
		);
		if (!found) return send(response, 404, { error: "Memory not found" });
		return send(response, 200, {
			id: found.id,
			content: found.content,
			created_at: found.created_at,
			metadata: { externalId: found.externalId, savedAt: found.savedAt },
		});
	}
	const match = url.pathname.match(/^\/v1\/memories\/([^/]+)$/);
	if (request.method === "DELETE" && match) {
		const index = records.findIndex(
			(record) => record.id === match[1] && record.user_id === url.searchParams.get("user_id"),
		);
		if (index < 0) return send(response, 404, { error: "not_found" });
		records.splice(index, 1);
		return send(response, 200, { success: true });
	}
	send(response, 404, { error: "not_found" });
}).listen(port, "127.0.0.1", () =>
	console.log(`[fixture] Atomic Memory DEMO FIXTURE on http://127.0.0.1:${port}`),
);
