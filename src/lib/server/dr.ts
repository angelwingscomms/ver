import type { SecretVal } from './qdrant';

export type WfClient = {
	create(opts: { params: Record<string, unknown> }): Promise<{ id: string }>;
	get(id: string): Promise<{
		status(): Promise<{ status: string; output?: unknown; error?: unknown }>;
		terminate(): Promise<void>;
	}>;
};

export type DrEnv = {
	DEEPRESEARCH_WF?: WfClient;
	VER_WORKFLOWS?: { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> };
	VER_WORKFLOWS_URL?: string;
	INTERNAL_TOKEN: string | { get(): Promise<string> };
	QDRANT_URL: SecretVal;
	QDRANT_KEY: SecretVal;
	MIN_START_KOBO?: string;
	MAX_PER_RESEARCH_KOBO?: string;
};

async function token(env: { INTERNAL_TOKEN: string | { get(): Promise<string> } }): Promise<string> {
	return typeof env.INTERNAL_TOKEN === 'string'
		? env.INTERNAL_TOKEN
		: await env.INTERNAL_TOKEN.get();
}

export async function wf(env: DrEnv, path: string, init: RequestInit = {}): Promise<Response> {
	const headers = {
		...(init.headers as Record<string, string>),
		authorization: `Bearer ${await token(env)}`
	};
	if (import.meta.env.DEV && env.VER_WORKFLOWS_URL) {
		return fetch(`${env.VER_WORKFLOWS_URL}${path}`, { ...init, headers });
	}
	return env.VER_WORKFLOWS!.fetch(`https://ver-workflows${path}`, { ...init, headers });
}

export async function create_instance(env: DrEnv, payload: Record<string, unknown>): Promise<string> {
	let id: string | undefined;
	let err: unknown;
	for (let a = 0; a < 3 && !id; a++) {
		try {
			const r = await wf(env, '/create', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!r.ok) throw new Error(`status ${r.status}: ${await r.text()}`);
			id = ((await r.json()) as { id: string }).id;
		} catch (e) {
			err = e;
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	if (!id) throw new Error(`failed to start workflow: ${String(err)}`);
	return id;
}

export async function status_instance(env: DrEnv, id: string, l = ''): Promise<Response> {
	return wf(env, `/status/${id}?l=${encodeURIComponent(l)}`);
}
