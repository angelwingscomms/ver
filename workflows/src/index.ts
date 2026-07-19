import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type DurableObjectState,
	type DurableObjectNamespace
} from 'cloudflare:workers';
import {
	FREE_STEPS,
	SYSTEM_PROMPT,
	MODEL,
	EMBEDDING_MODEL,
	EMBEDDING_PRICE,
	call_llm,
	search_bible,
	type Msg
} from '../../src/lib/deepresearch/core';
import { calc_cost, kobo } from '../../src/lib/server/pricing';
import { deduct, get_balance } from '../../src/lib/server/token_balance';
import type { WfClient } from '../../src/lib/server/dr';

type T = {
	step: string;
	k: string;
	n: number;
	c: string;
	cost?: number;
	cost_kind?: 'llm' | 'search';
};
type E = {
	OPENROUTER_KEY: { get(): Promise<string> };
	QDRANT_URL: { get(): Promise<string> };
	QDRANT_KEY: { get(): Promise<string> };
	TOKEN_RATE?: string;
	NGN_USD?: string;
	DR_LOG: DurableObjectNamespace;
	DR_INDEX: DurableObjectNamespace;
	DEEPRESEARCH_WF: WfClient;
	INTERNAL_TOKEN: string;
};

type R = { i: string; q: string; l: string; c: number; s?: string; n?: number };
type P = { q: string; l: string; u: string; b: number; n?: number };

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

async function log_think(
	env: E,
	log_id: string,
	step: string,
	k: string,
	n: number,
	c: string,
	cost?: number,
	cost_kind?: 'llm' | 'search'
) {
	const id = env.DR_LOG.idFromName(log_id);
	await env.DR_LOG.get(id).fetch('https://do/append', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ step, k, n, c, cost, cost_kind } satisfies T)
	});
}

function fmt_usd(n: number): string {
	return `$${n.toFixed(6)}`;
}

function search_cost_from_usage(usage?: { prompt_tokens: number }): number {
	if (!usage) return 0;
	return (usage.prompt_tokens / 1e6) * EMBEDDING_PRICE;
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
		const { q, l, u, b, n } = event.payload;
		const steps = Math.max(1, Math.floor(n ?? FREE_STEPS));
		const key = await this.env.OPENROUTER_KEY.get();
		const token_rate = Number(this.env.TOKEN_RATE) || 1.08;
		const ngn_usd = Number(this.env.NGN_USD) || 1440;
		const messages: Msg[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: q }
		];
		let answer = '';
		let billable = 0;
		let used = 0;
		let llm_cost = 0;
		let search_cost = 0;
		for (let t = 0; t < steps && !answer; t++) {
			used = t + 1;
			const force_finish = t === steps - 1 || (b > 0 && billable >= b);
			const { message: m, usage } = await step.do(`llm-${t}`, RETRY, async () => {
				const resp = await call_llm(key, messages, force_finish);
				const step_cost = usage?.total_cost ?? (usage
					? calc_cost(MODEL, usage.prompt_tokens, usage.completion_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0)
					: 0);
				if (step_cost > 0) llm_cost += step_cost;
				for (const th of thoughts_from_msg(resp.message))
					await log_think(this.env, l, `llm-${t}-${th.k}`, th.k, t, th.c, step_cost, 'llm');
				return resp;
			});
			if (usage && t >= FREE_STEPS) {
				const cache = usage.prompt_tokens_details?.cached_tokens ?? 0;
				billable += kobo(
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
					const s_cost = search_cost_from_usage(res.usage);
					if (s_cost > 0) search_cost += s_cost;
					await log_think(
						this.env,
						l,
						`search-${t}-${c.id}`,
						'verses',
						t,
						`Retrieved ${res.r.length} passage${res.r.length === 1 ? '' : 's'}`,
						s_cost,
						'search'
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
		const spent = Math.min(billable, b);
		let bal = 0;
		if (u) {
			try {
				bal = spent > 0 ? await deduct(this.env, u, spent) : await get_balance(this.env, u);
			} catch {
				/* balance update best-effort */
			}
		}
		try {
			const idx = this.env.DR_INDEX.idFromName('index');
			await this.env.DR_INDEX.get(idx).fetch('https://do/steps', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ i: event.instanceId, n: used })
			});
		} catch {
			/* steps-used persistence best-effort */
		}
		const total_cost = llm_cost + search_cost;
		const cost_block =
			`\n\n---\n\n# research cost\n\n` +
			`- **LLM cost** (OpenRouter ${MODEL}): ${fmt_usd(llm_cost)}\n` +
			`- **Search cost** (embeddings ${EMBEDDING_MODEL}): ${fmt_usd(search_cost)}\n` +
			`- **Total research cost**: ${fmt_usd(total_cost)}\n`;
		return {
			q,
			m: `# question\n\n${q}\n\n# answer\n\n${answer}${cost_block}`,
			c: spent,
			b: bal,
			n: used,
			llm_cost,
			search_cost,
			total_cost
		};
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
		if (req.method === 'POST' && u.pathname === '/steps') {
			const { i, n } = (await req.json()) as { i: string; n: number };
			const rec = (await this.state.storage.get(i)) as R | undefined;
			if (rec) await this.state.storage.put(i, { ...rec, n });
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
		const deny = check_auth(req, env);
		if (deny) return deny;
		if (u.pathname === '/list') {
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
			const { q, l, u, b, n } = (await req.json()) as {
				q: string;
				l: string;
				u?: string;
				b?: number;
				n?: number;
			};
			const inst = await env.DEEPRESEARCH_WF.create({
				params: { q, l, u: u ?? '', b: b ?? 0, n: n ?? FREE_STEPS }
			});
			const idx = env.DR_INDEX.idFromName('index');
			await env.DR_INDEX.get(idx).fetch('https://do/add', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ i: inst.id, q, l, c: Date.now() })
			});
			return new Response(JSON.stringify({ id: inst.id }), {
				headers: { 'content-type': 'application/json' }
			});
		}
		const m = u.pathname.match(/^\/thoughts\/([^/]+)$/);
		if (m) {
			const id = env.DR_LOG.idFromName(m[1]);
			return env.DR_LOG.get(id).fetch('https://do/thoughts');
		}
		const tm = u.pathname.match(/^\/terminate\/([^/]+)$/);
		if (tm) {
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
