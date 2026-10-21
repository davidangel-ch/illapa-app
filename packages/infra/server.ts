import "varlock/auto-load";

import { execSync } from "node:child_process";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";

import {
	API_DOMAIN,
	SERVER_DEV_PORT,
	SERVER_WORKER_NAME,
	WORKER_OBSERVABILITY,
} from "./constants.ts";
import { hyperdriveRef } from "./hyperdrive.ts";

// Workers have no git context at runtime, so resolve the commit at deploy time
// and pass it as a plaintext var binding for evlog's build identity.
function resolveServiceVersion(): string {
	const fromEnv = process.env.SERVICE_VERSION;
	if (fromEnv) {
		return fromEnv;
	}
	try {
		return execSync("git rev-parse --short HEAD").toString().trim();
	} catch {
		return "unknown";
	}
}

export const serviceVersion = resolveServiceVersion();

export const server = Cloudflare.Worker("server", {
	name: SERVER_WORKER_NAME,
	domain: API_DOMAIN,
	workersDev: true,
	main: "../../apps/server/src/index.ts",
	compatibility: {
		flags: ["nodejs_compat"],
	},
	observability: WORKER_OBSERVABILITY,
	env: {
		HYPERDRIVE: hyperdriveRef(),
		APP_ENV: Config.String("APP_ENV"),
		ALLOWED_ORIGINS: Config.String("ALLOWED_ORIGINS"),
		BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
		// Unset means the demo reset endpoint stays switched off.
		...(process.env.DEMO_RESET_SECRET
			? { DEMO_RESET_SECRET: Config.Redacted("DEMO_RESET_SECRET") }
			: {}),
		// Unset means route notes stay switched off.
		...(process.env.ATOMICMEMORY_API_URL && process.env.ATOMICMEMORY_API_KEY
			? {
					ATOMICMEMORY_API_URL: Config.String("ATOMICMEMORY_API_URL"),
					ATOMICMEMORY_API_KEY: Config.Redacted("ATOMICMEMORY_API_KEY"),
				}
			: {}),
		BETTER_AUTH_URL: Config.String("BETTER_AUTH_URL"),
		CREDENTIALS_ENCRYPTION_KEY: Config.Redacted("CREDENTIALS_ENCRYPTION_KEY"),
		OSRM_BASE_URL: Config.String("OSRM_BASE_URL"),
		TILES_API_URL: Config.String("TILES_API_URL"),
		WEATHER_API_URL: Config.String("WEATHER_API_URL"),
		CLIENT_IP_HEADER: Config.String("CLIENT_IP_HEADER"),
		SERVICE_VERSION: serviceVersion,
	},
	dev: {
		port: SERVER_DEV_PORT,
	},
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;
