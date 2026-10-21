import { PUBLIC_PROCEDURE_PATHS } from "@hack-the-andes-project/api/constants";
import type { Context as ApiContext } from "@hack-the-andes-project/api/context";
import { handleDemoRequest } from "@hack-the-andes-project/api/demo-request";
import { resetDemo } from "@hack-the-andes-project/api/demo-reset";
import { parseAtomicMemorySetup } from "@hack-the-andes-project/api/route-notes";
import { appRouter } from "@hack-the-andes-project/api/routers/index";
import { proxySimulatorRequest } from "@hack-the-andes-project/api/simulator-proxy";
import {
	type Auth,
	createAuth,
	createOriginMatcher,
	parseAllowedOrigins,
	type Session,
} from "@hack-the-andes-project/auth";
import { verifySecret } from "@hack-the-andes-project/business/crypto/index";
import {
	DEMO_RESET_PATH,
	DEMO_RESET_SECRET_HEADER,
} from "@hack-the-andes-project/business/demo-account";
import { DEMO_REQUESTS_PATH } from "@hack-the-andes-project/business/demo-request";
import {
	TILE_METADATA_HEADERS,
	TILES_API_PATH,
	TILES_API_UPSTREAM_PATHS,
	WEATHER_API_PATH,
	WEATHER_API_UPSTREAM_PATHS,
} from "@hack-the-andes-project/business/simulators";
import { createDb, type Database } from "@hack-the-andes-project/db";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { identifyUser } from "evlog/better-auth";
import { type EvlogVariables, evlog } from "evlog/hono";
import { initWorkersLogger } from "evlog/workers";
import { Hono, type Context as HonoContext } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

import {
	AUTH_PREFIX,
	CORS_PREFLIGHT_MAX_AGE_S,
	DEMO_REQUEST_RATE_LIMIT_MAX_REQUESTS,
	DEMO_REQUEST_RATE_LIMIT_WINDOW_MS,
	HTTP_STATUS_FORBIDDEN,
	HTTP_STATUS_PAYLOAD_TOO_LARGE,
	HTTP_STATUS_TOO_MANY_REQUESTS,
	MAX_REQUEST_BODY_BYTES,
	PUBLIC_PATHS,
	RPC_PREFIX,
	SERVICE_NAME,
} from "./constants";
import { ENV } from "./env.server";

initWorkersLogger({
	env: {
		service: SERVICE_NAME,
		environment: ENV.APP_ENV,
		version: ENV.SERVICE_VERSION,
	},
	// Defense-in-depth on top of evlog's built-in maskers. Bare keys match at
	// any depth, so they also scrub anything nested under procedures[].
	redact: {
		paths: [
			"authorization",
			"cookie",
			"password",
			"*_token",
			"accessToken",
			"refreshToken",
		],
	},
});

const isAllowedOrigin = createOriginMatcher(
	parseAllowedOrigins(ENV.ALLOWED_ORIGINS),
);

// db, auth and session are resolved once per request by the guard below and
// shared through the Hono context, so the /api/auth/* handler and the oRPC
// context reuse the same connection. The Hyperdrive binding only exists at
// request time and may not be touched in module scope.
interface Variables {
	log: EvlogVariables["Variables"]["log"];
	db: Database;
	auth: Auth;
	session: Session;
}

const app = new Hono<{ Variables: Variables }>();

interface DemoRequestWindow {
	count: number;
	expiresAt: number;
}

const demoRequestWindows = new Map<string | undefined, DemoRequestWindow>();

// Hono's executionCtx getter throws when there is no ExecutionContext
// (Node test runs); degrade to letting the promise float.
function waitUntilFor(
	context: Pick<HonoContext, "executionCtx">,
): ApiContext["waitUntil"] {
	try {
		const executionCtx = context.executionCtx;
		return executionCtx.waitUntil.bind(executionCtx);
	} catch {
		return (promise) => void promise;
	}
}

app.use(evlog());

// CORS before the auth guard so OPTIONS preflights short-circuit here and
// never pay for createDb() or the session lookup.
app.use(
	"/*",
	cors({
		origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "x-orpc-batch"],
		exposeHeaders: TILE_METADATA_HEADERS,
		credentials: true,
		maxAge: CORS_PREFLIGHT_MAX_AGE_S,
	}),
);

app.use("*", async (context, next) => {
	const origin = context.req.header("Origin");
	if (
		(context.req.path === RPC_PREFIX ||
			context.req.path.startsWith(`${RPC_PREFIX}/`)) &&
		!["GET", "HEAD", "OPTIONS"].includes(context.req.method) &&
		origin !== undefined &&
		!isAllowedOrigin(origin)
	) {
		context.get("log").set({ auth: { gate: "forbidden_origin", origin } });
		return context.json(
			{
				error: "forbidden_origin",
				message: "This origin is not allowed to call the API.",
			},
			HTTP_STATUS_FORBIDDEN,
		);
	}
	return next();
});

app.use(
	bodyLimit({
		maxSize: MAX_REQUEST_BODY_BYTES,
		onError: (context) =>
			context.json(
				{ error: "payload_too_large" },
				HTTP_STATUS_PAYLOAD_TOO_LARGE,
			),
	}),
);

app.post(DEMO_REQUESTS_PATH, async (context, next) => {
	const now = Date.now();
	for (const [clientIp, window] of demoRequestWindows) {
		if (window.expiresAt <= now) demoRequestWindows.delete(clientIp);
	}
	const clientIp = context.req.header(ENV.CLIENT_IP_HEADER);
	let window = demoRequestWindows.get(clientIp);
	if (!window) {
		window = { count: 0, expiresAt: now + DEMO_REQUEST_RATE_LIMIT_WINDOW_MS };
		demoRequestWindows.set(clientIp, window);
	}
	if (window.count >= DEMO_REQUEST_RATE_LIMIT_MAX_REQUESTS) {
		context.get("log").set({ demoRequest: { throttled: true } });
		return context.json(
			{ error: "too_many_demo_requests" },
			HTTP_STATUS_TOO_MANY_REQUESTS,
		);
	}
	window.count += 1;
	return next();
});

// Global auth guard: every route requires a session unless it is listed in
// PUBLIC_PATHS, lives under /api/auth/*, or is a PUBLIC_PROCEDURE_PATHS
// procedure. New routes are protected by default.
app.use("*", async (c, next) => {
	const path = c.req.path;
	if (PUBLIC_PATHS.has(path)) {
		return next();
	}

	// evlog/hono never reads request.cf, so stamp the edge context once here.
	// cf-ray is the cross-service request id; undefined values (local dev) are
	// skipped by evlog's merge.
	const edge = c.req.raw.cf;
	const cfRay = c.req.header("cf-ray");
	c.get("log").set({
		requestId: cfRay,
		cfRay,
		traceparent: c.req.header("traceparent"),
		colo: edge?.colo,
		country: edge?.country,
		asn: edge?.asn,
	});

	const db = await createDb(ENV.HYPERDRIVE);
	const auth = createAuth(ENV, db);
	c.set("db", db);
	c.set("auth", auth);

	// better-auth resolves its own session on /api/auth/*.
	if (path.startsWith(`${AUTH_PREFIX}/`)) {
		c.set("session", null);
		return next();
	}

	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	c.set("session", session);
	if (session) {
		identifyUser(c.get("log"), session, { maskEmail: true });
		return next();
	}
	const procedurePath = path.slice(RPC_PREFIX.length + 1).replaceAll("/", ".");
	if (
		path.startsWith(`${RPC_PREFIX}/`) &&
		!c.req.raw.headers.has("x-orpc-batch") &&
		PUBLIC_PROCEDURE_PATHS.has(procedurePath)
	) {
		return next();
	}
	c.get("log").set({ auth: { gate: "denied" } });
	return c.json(
		{ error: "unauthorized", message: "Sign in to access this resource." },
		401,
	);
});

app.on(["POST", "GET"], `${AUTH_PREFIX}/*`, (c) =>
	c.get("auth").handler(c.req.raw),
);

const rpcHandler = new RPCHandler(appRouter, {
	plugins: [new BatchHandlerPlugin()],
	interceptors: [
		onError(() => {
			// Errors are already captured on the wide event by the withLogger
			// middleware in @hack-the-andes-project/api; oRPC still renders them.
		}),
	],
});

app.use("/*", async (c, next) => {
	const path = c.req.path;
	if (path !== RPC_PREFIX && !path.startsWith(`${RPC_PREFIX}/`)) {
		return next();
	}

	const atomicMemorySetup = parseAtomicMemorySetup({
		apiUrl: ENV.ATOMICMEMORY_API_URL,
		apiKey: ENV.ATOMICMEMORY_API_KEY,
	});
	const context: ApiContext = {
		db: c.get("db"),
		auth: c.get("auth"),
		log: c.get("log"),
		session: c.get("session"),
		encryptionKey: ENV.CREDENTIALS_ENCRYPTION_KEY,
		osrmBaseUrl: ENV.OSRM_BASE_URL,
		waitUntil: waitUntilFor(c),
		atomicMemory:
			atomicMemorySetup.status === "on" ? atomicMemorySetup.config : undefined,
	};
	if (atomicMemorySetup.status === "invalid")
		c.get("log").set({
			routeNotes: { config: "invalid", reason: atomicMemorySetup.reason },
		});

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: RPC_PREFIX,
		context,
	});
	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	return next();
});

app.post(DEMO_REQUESTS_PATH, (context) =>
	handleDemoRequest({
		request: context.req.raw,
		createDatabase: () => createDb(ENV.HYPERDRIVE),
		log: context.get("log"),
	}),
);

app.post(DEMO_RESET_PATH, async (context) => {
	if (!ENV.DEMO_RESET_SECRET) {
		return context.notFound();
	}
	if (
		!verifySecret(
			context.req.header(DEMO_RESET_SECRET_HEADER),
			ENV.DEMO_RESET_SECRET,
		)
	) {
		return context.json({ error: "unauthorized" }, 401);
	}
	const db = await createDb(ENV.HYPERDRIVE);
	context.set("db", db);
	const result = await resetDemo({
		db,
		encryptionKey: ENV.CREDENTIALS_ENCRYPTION_KEY,
		osrmBaseUrl: ENV.OSRM_BASE_URL,
		log: context.get("log"),
	});
	if (!result) return context.json({ error: "demo_not_found" }, 404);
	context.get("log").set({ demo: { reset: true, ...result } });
	return context.json(result);
});

app.get(`${TILES_API_PATH}/*`, (c) =>
	proxySimulatorRequest({
		request: c.req.raw,
		role: c.get("session")?.user.role,
		pathPrefix: TILES_API_PATH,
		upstreamBaseUrl: ENV.TILES_API_URL,
		upstreamPaths: TILES_API_UPSTREAM_PATHS,
		service: "tiles",
		log: c.get("log"),
	}),
);

app.get(`${WEATHER_API_PATH}/*`, (c) =>
	proxySimulatorRequest({
		request: c.req.raw,
		role: c.get("session")?.user.role,
		pathPrefix: WEATHER_API_PATH,
		upstreamBaseUrl: ENV.WEATHER_API_URL,
		upstreamPaths: WEATHER_API_UPSTREAM_PATHS,
		service: "weather",
		log: c.get("log"),
	}),
);

app.get("/", (c) => c.text("OK"));

app.notFound((c) =>
	c.json(
		{ error: "not_found", message: "Route does not exist.", path: c.req.path },
		404,
	),
);

app.onError((error, c) => {
	let queryError = error;
	while (
		queryError.name !== "DrizzleQueryError" &&
		queryError.cause instanceof Error
	) {
		queryError = queryError.cause;
	}
	if (
		queryError.name === "DrizzleQueryError" &&
		"query" in queryError &&
		typeof queryError.query === "string"
	) {
		const driverError = queryError.cause;
		const driverCode =
			driverError instanceof Error &&
			"code" in driverError &&
			typeof driverError.code === "string"
				? driverError.code
				: undefined;
		c.get("log").set({ database: { query: queryError.query, driverCode } });
		// evlog reads c.error after onError returns, so it must be sanitized too.
		c.error = new Error("Database query failed");
		c.get("log").error(c.error);
	} else {
		c.get("log").error(error);
	}
	// An exception can bypass the cors() middleware, so re-apply CORS headers or
	// the browser reports an opaque CORS failure instead of the 500.
	const origin = c.req.header("Origin");
	if (origin && isAllowedOrigin(origin)) {
		c.header("Access-Control-Allow-Origin", origin);
		c.header("Access-Control-Allow-Credentials", "true");
		c.header("Vary", "Origin");
	}
	// The SQL text and driver code stay on the wide event, never the bound
	// params; the client only gets an id to quote back.
	const errorId = c.req.header("cf-ray") ?? crypto.randomUUID();
	c.get("log").set({ errorId });
	return c.json(
		{
			error: "internal_error",
			message: "Unexpected error. Please try again.",
			errorId,
		},
		500,
	);
});

export default app;
