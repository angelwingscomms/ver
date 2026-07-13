# Deep Bible Research (/deepresearch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/deepresearch` page where a user submits a Bible research question; a Cloudflare Workflow runs a long, autonomous, tool-calling research loop (`deepseek/deepseek-v4-flash` via OpenRouter, searching scripture through the existing `/api/search` endpoint), and when complete the result is rendered as Markdown with a download button.

**Architecture:** A separate workflow Worker (`ver-workflows`, in `workflows/`) owns the `DeepResearchWorkflow` class, because `@sveltejs/adapter-cloudflare` has no supported way to export extra classes from the generated worker. The SvelteKit app binds to it cross-script via `script_name` and exposes two JSON endpoints: `POST /api/deepresearch` (start) and `GET /api/deepresearch/[id]` (poll status; the workflow's return value is the result — no extra storage). The research loop lives in `src/lib/deepresearch/core.ts` (pure functions, unit-testable, imported by the workflow Worker via relative path). The frontend polls every 5 seconds, renders the Markdown with `marked`, and offers a client-side Blob download.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes) on Cloudflare Workers, Cloudflare Workflows, OpenRouter chat completions with tool calling (`deepseek/deepseek-v4-flash`, 1M context), Qdrant-backed search reused via the deployed `https://ver.apexlinks.org/api/search`, `marked` for Markdown rendering, Vitest.

## Global Constraints

- Naming: always snake_case for vars/functions; db payload, type defs, request JSON and page load return value keys always single letters. (Exception: OpenRouter tool-schema parameter names like `query`/`scope`/`book`/`chapter`/`answer` are read by the LLM and stay descriptive — they are not our request JSON.)
- Conciseness: no vars for single-use; code minimally.
- **Never start the dev server** (no `pnpm dev`, no `wrangler dev`, no `pnpm preview`). Verification is via `pnpm check`, `pnpm test:unit -- --run`, `pnpm build`, `wrangler deploy`, and `curl` against production.
- Never put `wrangler types` in the `build` script (breaks Workers Builds CI). `pnpm gen` runs it manually.
- Package manager is `pnpm`. All commands run from repo root `/home/ed/i/ver` unless stated.
- Deploy order matters: `ver-workflows` must be deployed **before** the main app's wrangler config references it via `script_name` (Task 2 before Task 5).
- OpenRouter model id is exactly `deepseek/deepseek-v4-flash` (verified live on 2026-07-13).
- Secrets come from Cloudflare Secrets Store, store_id `45748cb1c67946df943075fa14cb8815`; a binding is an object with `.get(): Promise<string>`, not a plain string.
- Existing search API contract (do not modify it): `GET /api/search?q=<text>` plus exactly one of `v` (verses) / `c` (chapters), optional `b=<full book name>` and `x=<chapter number>`; responds `{ r: [{ b, c, v?, t, s }] }`, top 10.
- Workflows limits that shape this design: step return values ≤ 1MiB; instance state retained 30 days (Paid) — results must be downloaded within that window; per-step CPU default 30s (our steps are network-bound, fine).

---

### Task 1: Core research module (`src/lib/deepresearch/core.ts`)

**Files:**

- Create: `src/lib/deepresearch/core.ts`
- Test: `src/lib/deepresearch/core.spec.ts`

**Interfaces:**

- Consumes: nothing from this repo (pure module; no `$env`, no `cloudflare:` imports — it must be importable from the client bundle, the SvelteKit server, and the workflow Worker).
- Produces (used by Tasks 2 and 4):
  - `MODEL: string`, `MAX_TURNS: number`, `SYSTEM_PROMPT: string`, `SEARCH_URL: string`, `TOOLS: unknown[]`
  - `type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }`
  - `type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }`
  - `slug(q: string): string`
  - `search_bible(args: Record<string, unknown>): Promise<unknown>` — throws `Error` on non-2xx
  - `call_llm(key: string, messages: Msg[], force_finish: boolean): Promise<Msg>` — throws `Error` on non-2xx

- [ ] **Step 1: Write the failing test**

Create `src/lib/deepresearch/core.spec.ts` with exactly:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { slug, search_bible, call_llm, MODEL, TOOLS } from './core';

afterEach(() => vi.unstubAllGlobals());

describe('slug', () => {
	it('kebab-cases the question', () => {
		expect(slug('What is the New Covenant?')).toBe('what-is-the-new-covenant');
	});
	it('falls back for empty input', () => {
		expect(slug('???')).toBe('research');
	});
});

describe('search_bible', () => {
	it('builds verse-scope url with filters', async () => {
		const fetch_mock = vi.fn(async () => new Response(JSON.stringify({ r: [] })));
		vi.stubGlobal('fetch', fetch_mock);
		await search_bible({ query: 'light', scope: 'verses', book: '1 Samuel', chapter: 3 });
		const url = String(fetch_mock.mock.calls[0][0]);
		expect(url).toContain('q=light');
		expect(url).toContain('v=');
		expect(url).toContain('b=1+Samuel');
		expect(url).toContain('x=3');
	});
	it('builds chapter-scope url without filters', async () => {
		const fetch_mock = vi.fn(async () => new Response(JSON.stringify({ r: [] })));
		vi.stubGlobal('fetch', fetch_mock);
		await search_bible({ query: 'exodus from egypt', scope: 'chapters' });
		const url = String(fetch_mock.mock.calls[0][0]);
		expect(url).toContain('c=');
		expect(url).not.toContain('b=');
	});
	it('throws on http error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		await expect(search_bible({ query: 'x', scope: 'verses' })).rejects.toThrow('search 500');
	});
});

describe('call_llm', () => {
	it('sends model and tools, returns the assistant message', async () => {
		const fetch_mock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }] })
				)
		);
		vi.stubGlobal('fetch', fetch_mock);
		const m = await call_llm('k', [{ role: 'user', content: 'q' }], false);
		expect(m.content).toBe('hi');
		const body = JSON.parse((fetch_mock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.model).toBe(MODEL);
		expect(body.tool_choice).toBe('auto');
		expect(body.tools).toHaveLength(TOOLS.length);
	});
	it('forces the finish tool when force_finish is true', async () => {
		const fetch_mock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ choices: [{ message: { role: 'assistant', content: null } }] })
				)
		);
		vi.stubGlobal('fetch', fetch_mock);
		await call_llm('k', [], true);
		const body = JSON.parse((fetch_mock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'finish' } });
	});
	it('throws on http error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 429 }))
		);
		await expect(call_llm('k', [], false)).rejects.toThrow('llm 429');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- --run src/lib/deepresearch/core.spec.ts`
Expected: FAIL — cannot resolve import `./core` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/deepresearch/core.ts` with exactly:

```ts
export const MODEL = 'deepseek/deepseek-v4-flash';
export const MAX_TURNS = 100;
export const SEARCH_URL = 'https://ver.apexlinks.org/api/search';

export type ToolCall = {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
};
export type Msg = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
};

export const SYSTEM_PROMPT = `You are a deep Bible research agent. Your ONLY source of truth is the search_bible tool, which performs semantic search over the complete text of the Bible (Young's Literal Translation).

First-principles rules:
- Build every claim, connection and conclusion EXCLUSIVELY from verse and chapter text returned by search_bible during this session.
- Drop everything you know or think you know about the Bible: no doctrines, commentaries, creeds, scholarly consensus or existing interpretations may serve as evidence.
- Your background knowledge may only suggest what to search next; nothing enters the answer unless retrieved text confirms it.
- Never cite a verse you have not retrieved in this session. Quote retrieved text verbatim.
- Derive meaning from patterns internal to the retrieved corpus: repeated vocabulary, structural parallels, coherence across books.
- If retrieved text is ambiguous or insufficient on a point, say so plainly instead of filling the gap.

Method:
- Research exhaustively and at length. Search many semantic angles per concept: synonyms, related motifs, imagery, both 'verses' and 'chapters' scope, book/chapter filters.
- Deliberately search for counter-evidence to your working hypotheses and resolve tensions using retrieved text only.
- Keep searching an angle until new queries stop returning new relevant passages, then pivot to another angle. Do not stop at the first plausible answer.
- Aim for dozens of searches before finishing (up to roughly 90 in total).

When your research is complete, call the finish tool exactly once. Its answer must be self-contained Markdown: the full synthesis, every referenced passage cited as Book chapter:verse with the retrieved wording, and a clear line of reasoning from the texts to the conclusion.`;

export const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'search_bible',
			description:
				"Semantic search over the entire Bible (Young's Literal Translation). Returns the 10 most similar passages as {b: book, c: chapter, v: verse, t: text, s: similarity score}.",
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Plain-language description of the meaning to search for'
					},
					scope: {
						type: 'string',
						enum: ['verses', 'chapters'],
						description: 'Search individual verses or whole chapters'
					},
					book: {
						type: 'string',
						description:
							'Optional exact book name filter, e.g. "Genesis", "1 Samuel", "Song of Solomon"'
					},
					chapter: {
						type: 'integer',
						description: 'Optional chapter number filter (use with book)'
					}
				},
				required: ['query', 'scope']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'finish',
			description: 'Finish the research and submit the complete final answer.',
			parameters: {
				type: 'object',
				properties: {
					answer: {
						type: 'string',
						description:
							'The complete final answer in Markdown. Cite every referenced passage as Book chapter:verse.'
					}
				},
				required: ['answer']
			}
		}
	}
];

export function slug(q: string): string {
	return (
		q
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60)
			.replace(/-+$/, '') || 'research'
	);
}

export async function search_bible(args: Record<string, unknown>): Promise<unknown> {
	const p = new URLSearchParams();
	p.set('q', String(args.query ?? ''));
	p.set(args.scope === 'chapters' ? 'c' : 'v', '');
	if (args.book) p.set('b', String(args.book));
	if (args.chapter != null && args.chapter !== '') p.set('x', String(args.chapter));
	const res = await fetch(`${SEARCH_URL}?${p}`);
	if (!res.ok) throw new Error(`search ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}

export async function call_llm(key: string, messages: Msg[], force_finish: boolean): Promise<Msg> {
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools: TOOLS,
			tool_choice: force_finish ? { type: 'function', function: { name: 'finish' } } : 'auto',
			temperature: 0.6
		})
	});
	if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return ((await res.json()) as { choices: { message: Msg }[] }).choices[0].message;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- --run src/lib/deepresearch/core.spec.ts`
Expected: PASS — 8 tests passing (2 slug, 3 search_bible, 3 call_llm).

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add src/lib/deepresearch/core.ts src/lib/deepresearch/core.spec.ts
git commit -m "feat: deep research core (prompt, tools, search/llm calls, slug)"
```

---

### Task 2: Workflow Worker `ver-workflows`

**Files:**

- Create: `workflows/wrangler.jsonc`
- Create: `workflows/src/index.ts`

**Interfaces:**

- Consumes from Task 1: `MAX_TURNS`, `SYSTEM_PROMPT`, `call_llm(key, messages, force_finish)`, `search_bible(args)`, `type Msg` — imported via relative path `../../src/lib/deepresearch/core` (wrangler's esbuild bundles across directories; this file is NOT covered by `pnpm check`, which only type-checks `src/`).
- Produces (used by Tasks 3 and 5): a deployed Worker named `ver-workflows` exposing workflow `deepresearch` (class `DeepResearchWorkflow`). Instance params: `{ q: string }` (the research question). Instance output on completion: `{ q: string; m: string }` where `m` is the full Markdown document `# question\n\n{q}\n\n# answer\n\n{answer}`.

- [ ] **Step 1: Create the wrangler config**

Create `workflows/wrangler.jsonc` with exactly:

```jsonc
{
	"$schema": "../node_modules/wrangler/config-schema.json",
	"name": "ver-workflows",
	"main": "src/index.ts",
	"compatibility_date": "2026-07-12",
	"observability": { "enabled": true },
	"workflows": [
		{ "name": "deepresearch", "binding": "DEEPRESEARCH_WF", "class_name": "DeepResearchWorkflow" }
	],
	"secrets_store_secrets": [
		{
			"binding": "OPENROUTER_KEY",
			"store_id": "45748cb1c67946df943075fa14cb8815",
			"secret_name": "OPENROUTER_KEY"
		}
	]
}
```

- [ ] **Step 2: Write the workflow**

Create `workflows/src/index.ts` with exactly:

```ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
	MAX_TURNS,
	SYSTEM_PROMPT,
	call_llm,
	search_bible,
	type Msg
} from '../../src/lib/deepresearch/core';

type E = { OPENROUTER_KEY: { get(): Promise<string> } };
type P = { q: string };

const RETRY = {
	retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
	timeout: '10 minutes'
} as const;

export class DeepResearchWorkflow extends WorkflowEntrypoint<E, P> {
	async run(event: WorkflowEvent<P>, step: WorkflowStep) {
		const q = event.payload.q;
		// read the secret outside step.do so it is never persisted in workflow state
		const key = await this.env.OPENROUTER_KEY.get();
		const messages: Msg[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: q }
		];
		let answer = '';
		for (let t = 0; t < MAX_TURNS && !answer; t++) {
			const m = await step.do(`llm-${t}`, RETRY, () =>
				call_llm(key, messages, t === MAX_TURNS - 1)
			);
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
					answer = String(args.answer ?? '');
					if (answer) break;
					messages.push({
						role: 'tool',
						tool_call_id: c.id,
						content:
							'finish rejected: answer was empty. Keep researching, then call finish with the full answer.'
					});
					continue;
				}
				const r = await step.do(`search-${t}-${c.id}`, RETRY, () => search_bible(args));
				messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(r) });
			}
		}
		if (!answer)
			answer =
				[...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ??
				'No answer produced.';
		return { q, m: `# question\n\n${q}\n\n# answer\n\n${answer}` };
	}
}

export default {
	fetch: () => new Response('ver-workflows', { status: 404 })
};
```

- [ ] **Step 3: Deploy the workflow Worker**

Run: `npx wrangler deploy -c workflows/wrangler.jsonc`
Expected: successful upload of Worker `ver-workflows` listing binding `DEEPRESEARCH_WF` (workflow `deepresearch`) and secrets-store binding `OPENROUTER_KEY`. If it errors on auth, stop and report — the user must run `npx wrangler login`.

- [ ] **Step 4: Verify with a real instance (live end-to-end of the loop)**

```bash
npx wrangler workflows trigger deepresearch '{"q":"What does light mean in the Bible?"}' -c workflows/wrangler.jsonc
```

Expected: prints an instance id. Then poll (repeat up to 10 times, 60s apart):

```bash
npx wrangler workflows instances describe deepresearch latest -c workflows/wrangler.jsonc
```

Expected: status progresses through `running` with visible `llm-0`, `search-0-*` steps succeeding. Do NOT wait for completion (a full run may take a long time by design) — success criterion is: at least one `llm-*` step and one `search-*` step have completed without error. If steps show errors, read the error output, fix, redeploy, re-trigger.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add workflows/wrangler.jsonc workflows/src/index.ts
git commit -m "feat: ver-workflows worker with deepresearch workflow (tool-calling research loop)"
```

---

### Task 3: Bind the workflow and add the API endpoints

**Files:**

- Modify: `wrangler.jsonc` (repo root)
- Modify: `worker-configuration.d.ts` (regenerated by command, not by hand)
- Create: `src/routes/api/deepresearch/+server.ts`
- Create: `src/routes/api/deepresearch/[id]/+server.ts`

**Interfaces:**

- Consumes from Task 2: deployed workflow `deepresearch` on Worker `ver-workflows`; instance output `{ q: string; m: string }`.
- Produces (used by Task 4):
  - `POST /api/deepresearch` — request JSON `{ q: string }`; 200 response `{ i: string }` (instance id); 400 `{ message: 'q required' }` if `q` missing/blank.
  - `GET /api/deepresearch/{id}` — 200 response `{ s: string; o: { q: string; m: string } | null; e: unknown }` where `s` ∈ `queued|running|paused|errored|terminated|complete|waiting|waitingForPause|unknown`, `o` is non-null only when `s === 'complete'`; 404 if instance unknown.

- [ ] **Step 1: Add the cross-script workflow binding**

In root `wrangler.jsonc`, insert after the `"secrets_store_secrets": [...]` array (add a comma after its closing `]`):

```jsonc
	"workflows": [
		{
			"name": "deepresearch",
			"binding": "DEEPRESEARCH_WF",
			"class_name": "DeepResearchWorkflow",
			"script_name": "ver-workflows"
		}
	],
```

- [ ] **Step 2: Regenerate binding types**

Run: `pnpm gen`
Expected: `worker-configuration.d.ts` regenerated; it now contains `DEEPRESEARCH_WF: Workflow;` in `interface Env`. Verify: `grep DEEPRESEARCH_WF worker-configuration.d.ts` prints that line.

- [ ] **Step 3: Write the start endpoint**

Create `src/routes/api/deepresearch/+server.ts` with exactly:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	const { q } = (await request.json().catch(() => ({}))) as { q?: string };
	if (!q?.trim()) throw error(400, 'q required');
	return json({ i: (await platform!.env.DEEPRESEARCH_WF.create({ params: { q: q.trim() } })).id });
};
```

- [ ] **Step 4: Write the status endpoint**

Create `src/routes/api/deepresearch/[id]/+server.ts` with exactly:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
	let inst;
	try {
		inst = await platform!.env.DEEPRESEARCH_WF.get(params.id);
	} catch {
		throw error(404, 'not found');
	}
	const st = await inst.status();
	return json({ s: st.status, o: st.output ?? null, e: st.error ?? null });
};
```

- [ ] **Step 5: Type-check**

Run: `pnpm check`
Expected: PASS (`svelte-check` 0 errors; `wrangler types --check` clean). If `st.output` typing complains, the endpoints compile as-is with the generated `Workflow` type — do not add casts unless check fails, and if it fails cast with `st.output as { q: string; m: string } | undefined`.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add wrangler.jsonc worker-configuration.d.ts src/routes/api/deepresearch
git commit -m "feat: bind deepresearch workflow, add start/status API endpoints"
```

---

### Task 4: `/deepresearch` page

**Files:**

- Modify: `package.json` (via `pnpm add marked`)
- Create: `src/routes/deepresearch/+page.svelte`

**Interfaces:**

- Consumes from Task 3: `POST /api/deepresearch` → `{ i }`; `GET /api/deepresearch/{id}` → `{ s, o, e }`. Consumes from Task 1: `slug(q)` from `$lib/deepresearch/core`.
- Produces: user-facing page at `/deepresearch`.

- [ ] **Step 1: Add the markdown renderer**

Run: `pnpm add marked`
Expected: `marked` added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the page**

Create `src/routes/deepresearch/+page.svelte` with exactly:

```svelte
<script lang="ts">
	import { marked } from 'marked';
	import { slug } from '$lib/deepresearch/core';

	type O = { q: string; m: string };
	let q = $state('');
	let i = $state('');
	let s = $state('');
	let o = $state<O | null>(null);
	let msg = $state('');
	let starting = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	if (typeof localStorage !== 'undefined') {
		const saved = localStorage.getItem('dr');
		if (saved) ({ q, i } = JSON.parse(saved));
	}

	async function poll() {
		if (!i) return;
		try {
			const res = await fetch(`/api/deepresearch/${i}`);
			if (!res.ok) {
				stop_poll();
				msg =
					res.status === 404 ? 'research not found (it may have expired)' : 'status check failed';
				return;
			}
			const d = (await res.json()) as { s: string; o: O | null; e: unknown };
			s = d.s;
			if (d.s === 'complete') {
				o = d.o;
				stop_poll();
			} else if (d.s === 'errored' || d.s === 'terminated') {
				msg = `research ${d.s}${d.e ? `: ${JSON.stringify(d.e)}` : ''}`;
				stop_poll();
			}
		} catch {
			/* transient network error: keep polling */
		}
	}

	function stop_poll() {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	$effect(() => {
		if (i && !o) {
			poll();
			timer = setInterval(poll, 5000);
		}
		return stop_poll;
	});

	async function start() {
		if (!q.trim() || starting) return;
		starting = true;
		msg = '';
		o = null;
		s = '';
		try {
			const res = await fetch('/api/deepresearch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ q })
			});
			const d = (await res.json()) as { i?: string; message?: string };
			if (!res.ok || !d.i) {
				msg = d.message ?? 'failed to start';
				return;
			}
			i = d.i;
			localStorage.setItem('dr', JSON.stringify({ q, i }));
		} catch {
			msg = 'failed to start';
		} finally {
			starting = false;
		}
	}

	function download() {
		if (!o) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([o.m], { type: 'text/markdown' }));
		a.download = `${slug(o.q)}.md`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function reset() {
		stop_poll();
		q = '';
		i = '';
		s = '';
		o = null;
		msg = '';
		localStorage.removeItem('dr');
	}
</script>

<svelte:head>
	<title>Deep Bible Research</title>
	<meta
		name="description"
		content="Long-running, first-principles Bible research synthesized purely from retrieved scripture."
	/>
</svelte:head>

<main>
	<header class="hero">
		<p class="kicker">Young's Literal Translation</p>
		<h1>Deep Research</h1>
		<p class="lede">
			Ask a question. An agent searches scripture exhaustively and synthesizes an answer from the
			retrieved text alone. This can take a long time — leave this page open or come back later.
		</p>
	</header>

	{#if !i}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				start();
			}}
		>
			<textarea
				placeholder="e.g. What does the Bible itself say bread means, from Genesis to Revelation?"
				bind:value={q}
				rows="3"
				aria-label="Research question"></textarea>
			<button type="submit" disabled={starting}>{starting ? 'Starting…' : 'Start research'}</button>
		</form>
	{:else if !o}
		<section class="status">
			<p class="question">“{q}”</p>
			{#if msg}
				<p class="msg">{msg}</p>
				<button type="button" class="ghost" onclick={reset}>New research</button>
			{:else}
				<div class="spinner" aria-hidden="true"></div>
				<p class="msg muted">Researching… status: {s || 'starting'}</p>
			{/if}
		</section>
	{:else}
		<section class="result">
			<div class="bar">
				<button type="button" onclick={download}>Download .md</button>
				<button type="button" class="ghost" onclick={reset}>New research</button>
			</div>
			<article class="md">{@html marked.parse(o.m) as string}</article>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.25rem 5rem;
	}
	.hero {
		text-align: center;
		margin-bottom: 2.5rem;
	}
	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.22em;
		font-size: 0.7rem;
		color: #1e40af;
		margin: 0 0 0.6rem;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}
	h1 {
		font-size: clamp(2.2rem, 6vw, 3.2rem);
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.01em;
		color: #16233f;
	}
	.lede {
		margin: 0.75rem auto 0;
		max-width: 32rem;
		color: #475569;
		font-size: 1.05rem;
		line-height: 1.5;
	}
	form {
		display: grid;
		gap: 0.6rem;
		background: #ffffff;
		padding: 0.7rem;
		border: 1px solid #dbe3f0;
		border-radius: 14px;
		box-shadow:
			0 1px 2px rgba(22, 35, 63, 0.04),
			0 12px 30px -18px rgba(22, 35, 63, 0.25);
	}
	textarea {
		width: 100%;
		padding: 0.8rem 0.9rem;
		font-size: 1rem;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		resize: vertical;
	}
	textarea:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}
	button {
		height: 3rem;
		padding: 0 1.4rem;
		font-size: 1rem;
		font-weight: 600;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: #fff;
		background: #1d4ed8;
		border: none;
		border-radius: 9px;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #1e40af;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	button.ghost {
		color: #1d4ed8;
		background: #eef2f9;
		border: 1px solid #dbe3f0;
	}
	.status {
		text-align: center;
		margin-top: 2rem;
	}
	.question {
		color: #16233f;
		font-size: 1.1rem;
	}
	.spinner {
		width: 2rem;
		height: 2rem;
		margin: 1.2rem auto 0;
		border: 3px solid #dbe3f0;
		border-top-color: #1d4ed8;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.msg {
		text-align: center;
		color: #1d4ed8;
		margin: 1.2rem 0;
		font-size: 0.98rem;
	}
	.msg.muted {
		color: #94a3b8;
	}
	.result {
		margin-top: 2rem;
	}
	.bar {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		margin-bottom: 1.2rem;
	}
	.md {
		background: #ffffff;
		border: 1px solid #e4e9f2;
		border-radius: 12px;
		padding: 1.5rem 1.75rem;
		line-height: 1.7;
		color: #1e293b;
	}
	.md :global(h1) {
		font-size: 1.5rem;
		color: #16233f;
	}
	.md :global(h2) {
		font-size: 1.2rem;
		color: #16233f;
	}
	.md :global(blockquote) {
		border-left: 3px solid #c3d0ea;
		margin: 1rem 0;
		padding: 0.2rem 1rem;
		color: #475569;
	}
	.md :global(code) {
		background: #eef2f9;
		border-radius: 4px;
		padding: 0.1rem 0.35rem;
	}
</style>
```

- [ ] **Step 3: Type-check, test, build**

Run: `pnpm check && pnpm test:unit -- --run && pnpm build`
Expected: all PASS. Note: `{@html marked.parse(o.m) as string}` — if svelte-check rejects the inline `as` cast inside `{@html}`, replace that line with `{@html String(marked.parse(o.m))}` and re-run.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add package.json pnpm-lock.yaml src/routes/deepresearch/+page.svelte
git commit -m "feat: /deepresearch page with polling, markdown render, download"
```

---

### Task 5: Deploy and verify end-to-end

**Files:**

- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: everything above, deployed.
- Produces: live feature at `https://ver.apexlinks.org/deepresearch`; deploy note in `AGENTS.md`.

- [ ] **Step 1: Deploy the main app**

Run: `pnpm build && npx wrangler deploy`
Expected: successful upload of Worker `ver` with binding `DEEPRESEARCH_WF → ver-workflows/DeepResearchWorkflow`. (The `ver-workflows` Worker was already deployed in Task 2 — required for this binding to resolve.)

- [ ] **Step 2: Verify the API end-to-end**

```bash
curl -sS --max-time 90 -X POST https://ver.apexlinks.org/api/deepresearch \
  -H 'Content-Type: application/json' -d '{"q":"According to retrieved scripture only, what is wisdom?"}'
```

Expected: `{"i":"<uuid>"}`. Then, substituting the id:

```bash
curl -sS --max-time 90 https://ver.apexlinks.org/api/deepresearch/<uuid>
```

Expected: `{"s":"running","o":null,"e":null}` (or `queued`). Poll every 60s (up to 30 minutes) until `"s":"complete"`; then verify `o.m` starts with `# question` and contains `# answer` followed by substantial Markdown with Book chapter:verse citations. If instead `"s":"errored"`, run `npx wrangler workflows instances describe deepresearch <uuid> -c workflows/wrangler.jsonc`, read the failing step's error, fix, redeploy the failing Worker, and re-test. Also verify the 400 and 404 paths:

```bash
curl -sS -X POST https://ver.apexlinks.org/api/deepresearch -H 'Content-Type: application/json' -d '{}'
curl -sS https://ver.apexlinks.org/api/deepresearch/does-not-exist
```

Expected: first returns status 400 with `q required`; second returns status 404.

- [ ] **Step 3: Verify the page is served**

Run: `curl -sS -o /dev/null -w '%{http_code}' https://ver.apexlinks.org/deepresearch`
Expected: `200`. (Interactive UI behavior — polling, render, download — runs the same code paths just verified via curl plus `marked`; the user does final visual QA in a browser.)

- [ ] **Step 4: Record the deploy rule**

Append to `AGENTS.md` under the Build/Deploy section:

```markdown
- Workflows worker: `workflows/` deploys separately with `npx wrangler deploy -c workflows/wrangler.jsonc` (NOT built by Workers Builds). Deploy it before the main app whenever `workflows/` or `src/lib/deepresearch/core.ts` changes.
```

- [ ] **Step 5: Commit and push**

```bash
git add AGENTS.md
git commit -m "docs: deploy note for ver-workflows"
git push origin master
```

Expected: push succeeds; Workers Builds redeploys the main app from CI (already identical to the direct deploy).
