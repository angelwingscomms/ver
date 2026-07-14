import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type DurableObjectState,
	type DurableObjectNamespace
} from 'cloudflare:workers';
import {
	MAX_TURNS,
	SYSTEM_PROMPT,
	MODEL,
	call_llm,
	search_bible,
	type Msg
} from '../../src/lib/deepresearch/core';
import { calc_cost, kobo } from '../../src/lib/server/pricing';
import { deduct, get_balance } from '../../src/lib/server/token_balance';

type WF = {
	create(opts: { params: P }): Promise<{ id: string }>;
	get(id: string): Promise<{
		status(): Promise<{ status: string; output?: unknown; error?: unknown }>;
		terminate(): Promise<void>;
	}>;
};

type T = { step: string; k: string; n: number; c: string };
type E = {
	OPENROUTER_KEY: { get(): Promise<string> };
	QDRANT_URL: { get(): Promise<string> };
	QDRANT_KEY: { get(): Promise<string> };
	TOKEN_RATE?: string;
	NGN_USD?: string;
	DR_LOG: DurableObjectNamespace;
	DR_INDEX: DurableObjectNamespace;
	DEEPRESEARCH_WF: WF;
	INTERNAL_TOKEN: string;
};

type R = { i: string; q: string; l: string; c: number; s?: string };
type P = { q: string; log_id: string; user_id: string; budget_kobo: number };

function check_auth(req: Request, env: E): Response | null {
	if (req.headers.get('authorization') !== `Bearer ${env.INTERNAL_TOKEN}`)
		return new Response('unauthorized', { status: 401 });
	return null;
}

const RETRY = {
	retries: { limit: 9, delay: '30 seconds', backoff: 'exponential' },
	timeout: '10 minutes'
} as const;

function thoughts_from_msg(m: Msg): { k: string; c: string }[] {
	const out: { k: string; c: string }[] = [];
	if (m.content) out.push({ k: 'think', c: m.content });
	for (const tc of m.tool_calls ?? []) {
		if (tc.function.name === 'search_bible') {
			let q = '';
			try {
				q = String(JSON.parse(tc.function.arguments || '{}').query ?? '');
			} catch {
				/* malformed args -> empty query */
			}
			out.push({ k: 'search', c: q ? `Searching scripture: "${q}"` : 'Searching scripture…' });
		} else if (tc.function.name === 'finish') {
			out.push({ k: 'finish', c: 'Synthesizing final answer…' });
		}
	}
	if (!out.length) out.push({ k: 'think', c: '(thinking…)' });
	return out;
}

async function log_think(env: E, log_id: string, step: string, k: string, n: number, c: string) {
	const id = env.DR_LOG.idFromName(log_id);
	await env.DR_LOG.get(id).fetch('https://do/append', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ step, k, n, c } satisfies T)
	});
}

async function record_thoughts(env: E, log_id: string, t: number, m: Msg) {
	for (const th of thoughts_from_msg(m))
		await log_think(env, log_id, `llm-${t}-${th.k}`, th.k, t, th.c);
}

export class DrLog {
	constructor(private state: DurableObjectState) {}
	async fetch(req: Request): Promise<Response> {
		const u = new URL(req.url);
		if (req.method === 'POST' && u.pathname === '/append') {
			const t = (await req.json()) as T;
			const all = ((await this.state.storage.get('t')) ?? []) as T[];
			const i = all.findIndex((x) => x.step === t.step);
			if (i >= 0) all[i] = t;
			else all.push(t);
			await this.state.storage.put('t', all);
			return new Response('ok');
		}
		if (u.pathname === '/thoughts') {
			const all = ((await this.state.storage.get('t')) ?? []) as T[];
			return new Response(JSON.stringify({ t: all }), {
				headers: { 'content-type': 'application/json' }
			});
		}
		return new Response('not found', { status: 404 });
	}
}

export class DeepResearchWorkflow extends WorkflowEntrypoint<E, P> {
	async run(event: WorkflowEvent<P>, step: WorkflowStep) {
		const { q, log_id, user_id, budget_kobo } = event.payload;
		const key = await this.env.OPENROUTER_KEY.get();
		const token_rate = Number(this.env.TOKEN_RATE) || 1.08;
		const ngn_usd = Number(this.env.NGN_USD) || 1440;
		const messages: Msg[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: q }
		];
		let answer = '';
		let cost_kobo = 0;
		for (let t = 0; t < MAX_TURNS && !answer; t++) {
			const force_finish = t === MAX_TURNS - 1 || cost_kobo >= budget_kobo;
			const { message: m, usage } = await step.do(`llm-${t}`, RETRY, async () => {
				const resp = await call_llm(key, messages, force_finish);
				await record_thoughts(this.env, log_id, t, resp.message);
				return resp;
			});
			if (usage) {
				const cache = usage.prompt_tokens_details?.cached_tokens ?? 0;
				cost_kobo += kobo(
					calc_cost(MODEL, usage.prompt_tokens, usage.completion_tokens, cache),
					token_rate,
					ngn_usd
				);
			}
			messages.push(m);
			if (!m.tool_calls?.length) {
				messages.push({
					role: 'user',
					content:
						'Continue: call search_bible to research further, or call finish with your complete final answer.'
				});
				continue;
			}
			for (const c of m.tool_calls) {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(c.function.arguments || '{}');
				} catch {
					args = {};
				}
				if (c.function.name === 'finish') {
					const ans = String(args.answer ?? '');
					answer = ans;
					if (answer) break;
					messages.push({
						role: 'tool',
						tool_call_id: c.id,
						content:
							'finish rejected: answer was empty. Keep researching, then call finish with the full answer.'
					});
					continue;
				}
				const r = await step.do(`search-${t}-${c.id}`, RETRY, async () => {
					const res = await search_bible(args);
					const arr = Array.isArray(res)
						? res
						: Array.isArray((res as { r?: unknown[] }).r)
							? (res as { r: unknown[] }).r
							: [];
					await log_think(
						this.env,
						log_id,
						`search-${t}-${c.id}`,
						'verses',
						t,
						`Retrieved ${arr.length} passage${arr.length === 1 ? '' : 's'}`
					);
					return res;
				});
				messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(r) });
			}
		}
		if (!answer)
			answer =
				[...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ??
				'No answer produced.';
		const spent = Math.min(cost_kobo, budget_kobo);
		let bal = 0;
		if (user_id) {
			try {
				bal =
					spent > 0 ? await deduct(this.env, user_id, spent) : await get_balance(this.env, user_id);
			} catch {
				/* balance update best-effort */
			}
		}
		return { q, m: `# question\n\n${q}\n\n# answer\n\n${answer}`, c: spent, b: bal };
	}
}

export class DrIndex {
	constructor(private state: DurableObjectState) {}
	async fetch(req: Request): Promise<Response> {
		const u = new URL(req.url);
		if (req.method === 'POST' && u.pathname === '/add') {
			const r = (await req.json()) as R;
			await this.state.storage.put(r.i, { i: r.i, q: r.q, l: r.l, c: r.c });
			return new Response('ok');
		}
		if (u.pathname === '/list') {
			const all = Array.from((await this.state.storage.list()).values()) as R[];
			all.sort((a, b) => (b.c ?? 0) - (a.c ?? 0));
			return new Response(JSON.stringify({ r: all }), {
				headers: { 'content-type': 'application/json' }
			});
		}
		return new Response('not found', { status: 404 });
	}
}

export default {
	async fetch(req: Request, env: E): Promise<Response> {
		const u = new URL(req.url);
		if (u.pathname === '/list') {
			const deny = check_auth(req, env);
			if (deny) return deny;
			const idx = env.DR_INDEX.idFromName('index');
			const raw = await env.DR_INDEX.get(idx).fetch('https://do/list');
			const recs = (await raw.json()) as { r: R[] };
			for (const rec of recs.r) {
				try {
					const st = await (await env.DEEPRESEARCH_WF.get(rec.i)).status();
					rec.s = st.status;
				} catch {
					rec.s = 'unknown';
				}
			}
			return new Response(JSON.stringify({ r: recs.r }), {
				headers: { 'content-type': 'application/json' }
			});
		}
		if (req.method === 'POST' && u.pathname === '/create') {
			const deny = check_auth(req, env);
			if (deny) return deny;
			const { q, log_id, user_id, budget_kobo } = (await req.json()) as {
				q: string;
				log_id: string;
				user_id?: string;
				budget_kobo?: number;
			};
			const inst = await env.DEEPRESEARCH_WF.create({
				params: { q, log_id, user_id: user_id ?? '', budget_kobo: budget_kobo ?? 0 }
			});
			const idx = env.DR_INDEX.idFromName('index');
			await env.DR_INDEX.get(idx).fetch('https://do/add', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ i: inst.id, q, l: log_id, c: Date.now() })
			});
			return new Response(JSON.stringify({ id: inst.id }), {
				headers: { 'content-type': 'application/json' }
			});
		}
		const m = u.pathname.match(/^\/thoughts\/([^/]+)$/);
		if (m) {
			const deny = check_auth(req, env);
			if (deny) return deny;
			const id = env.DR_LOG.idFromName(m[1]);
			return env.DR_LOG.get(id).fetch('https://do/thoughts');
		}
		const tm = u.pathname.match(/^\/terminate\/([^/]+)$/);
		if (tm) {
			const deny = check_auth(req, env);
			if (deny) return deny;
			try {
				await env.DEEPRESEARCH_WF.get(tm[1]).terminate();
				return new Response(JSON.stringify({ ok: true }), {
					headers: { 'content-type': 'application/json' }
				});
			} catch (e) {
				return new Response(JSON.stringify({ error: String(e) }), {
					status: 500,
					headers: { 'content-type': 'application/json' }
				});
			}
		}
		const sm = u.pathname.match(/^\/status\/([^/]+)$/);
		if (sm) {
			const deny = check_auth(req, env);
			if (deny) return deny;
			const l = u.searchParams.get('l') ?? '';
			try {
				const inst = await env.DEEPRESEARCH_WF.get(sm[1]);
				const st = await inst.status();
				let t: unknown[] = [];
				if (l) {
					const did = env.DR_LOG.idFromName(l);
					const dr = await env.DR_LOG.get(did).fetch('https://do/thoughts');
					if (dr.ok) t = ((await dr.json()) as { t: unknown[] }).t;
				}
				return new Response(
					JSON.stringify({ s: st.status, o: st.output ?? null, e: st.error ?? null, t }),
					{ headers: { 'content-type': 'application/json' } }
				);
			} catch {
				return new Response(JSON.stringify({ message: 'not found' }), {
					status: 404,
					headers: { 'content-type': 'application/json' }
				});
			}
		}
		return new Response('ver-workflows', { status: 404 });
	}
};
