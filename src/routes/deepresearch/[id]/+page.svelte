<script lang="ts">
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import { loadResearch, loadKey, type ResearchState } from '$lib/deepresearch/sw-db';
	import '$lib/deepresearch/dr.css';
	import { slug, type RetryError } from '$lib/deepresearch/core';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	type CostKind = 'llm' | 'search';
	type T = { k: string; n: number; c: string; cost?: number; cost_kind?: CostKind };
	let state = $state(null as ResearchState | null);
	let thoughts = $state([] as T[]);
	let errors = $state([] as RetryError[]);
	let stale = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	const id = $derived(page.params.id);
	const q = $derived(page.url.searchParams.get('q') ?? '');
	const STALE_MS = 30_000;

	async function check() {
		const s = await loadResearch(id);
		if (!s) return;
		state = s;
		thoughts = s.thoughtLog.slice().sort((a, b) => a.n - b.n || 0);
		errors = (s.errors || []).slice();
		stale = s.status === 'running' && Date.now() - s.updatedAt > STALE_MS;
		if (s.status === 'complete' || s.status === 'error') stop();
	}

	function stop() {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	function postMsg(data: Record<string, unknown>): Promise<void> {
		return new Promise((res) => {
			const ix = setInterval(async () => {
				const reg = await navigator.serviceWorker.ready;
				if (reg.active) {
					clearInterval(ix);
					reg.active.postMessage(data);
					res();
				}
			}, 200);
		});
	}

	async function resume() {
		const key = await loadKey();
		if (!key) {
			goto('/settings');
			return;
		}
		if (state) state.status = 'running';
		stale = false;
		await postMsg({ type: 'resume-research', id, key });
	}

	$effect(() => {
		if (!browser || !id) return;
		check();
		const swMsg = (e: MessageEvent) => {
			const d = e.data;
			if (d.id === id) {
				if (d.type === 'progress' || d.type === 'status') {
					if (d.state) state = d.state;
					if (d.thoughts) thoughts = d.thoughts.slice().sort((a: T, b: T) => a.n - b.n || 0);
				}
				if (d.type === 'complete') {
					state = { ...(state || {}), status: 'complete', answer: d.answer, thoughtLog: d.thoughtLog } as ResearchState;
					thoughts = (d.thoughtLog || []).slice().sort((a: T, b: T) => a.n - b.n || 0);
					stop();
				}
				if (d.type === 'paused') {
					if (state) state.status = 'paused';
					if (d.thoughts) thoughts = d.thoughts.slice().sort((a: T, b: T) => a.n - b.n || 0);
				}
				if (d.type === 'error') {
					state = { ...(state || {}), status: 'error', error: d.error } as ResearchState;
					stop();
				}
				if (d.type === 'error-log') {
					console.log(`[research error] turn ${d.error.turn}, attempt ${d.error.attempt}: ${d.error.message}`);
					if (d.error.detail) console.debug(d.error.detail);
					errors = [...errors, d.error].sort((a, b) => a.timestamp - b.timestamp);
				}
			}
		};
		navigator.serviceWorker.addEventListener('message', swMsg);
		timer = setInterval(check, 3000);
		return () => {
			stop();
			navigator.serviceWorker.removeEventListener('message', swMsg);
		};
	});

	function download() {
		if (!state?.answer) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([state.answer], { type: 'text/markdown' }));
		a.download = `${slug(state.question)}.md`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function fmtCost(n?: number): string {
		if (n == null) return '$0';
		return `$${n.toFixed(6)}`;
	}
</script>

<svelte:head>
	<title>Deep Research</title>
	<meta
		name="description"
		content="Long-running, first-principles Bible research synthesized purely from retrieved scripture."
	/>
</svelte:head>

<main>
	<header class="hero">
		<p class="kicker">Young's Literal Translation</p>
		<h1>Deep Research</h1>
		<button type="button" class="ghost back" onclick={() => goto('/deepresearch')}
			>← All research</button
		>
	</header>

	<section class="status">
		<p class="question">“{q || id}”</p>
		{#if state?.status === 'error'}
			<p class="msg error">Research errored: {state.error}</p>
			<div class="actions">
				<button type="button" onclick={resume}>Retry</button>
				<button type="button" class="ghost" onclick={() => goto('/deepresearch')}
					>New research</button
				>
			</div>
		{:else if state?.status === 'paused'}
			<p class="msg paused">Research paused — the browser stopped the worker.</p>
			{#if thoughts.length}
				<ul class="thoughts">
					{#each thoughts as th, idx (idx)}
						<li class="thought {th.k}">
							<span class="tag">{th.k}</span>
							<span class="txt">{th.c}</span>
							{#if th.cost}
								<span class="stepcost">${th.cost.toFixed(6)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<div class="actions">
				<button type="button" onclick={resume}>▶ Resume research</button>
				<button type="button" class="ghost" onclick={() => goto('/deepresearch')}
					>New research</button
				>
			</div>
		{:else if state?.status === 'running'}
			{#if stale}
				<p class="msg paused">Research stalled — the browser stopped the worker.</p>
				{#if thoughts.length}
					<ul class="thoughts">
						{#each thoughts as th, idx (idx)}
							<li class="thought {th.k}">
								<span class="tag">{th.k}</span>
								<span class="txt">{th.c}</span>
								{#if th.cost}
									<span class="stepcost">${th.cost.toFixed(6)}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<div class="actions">
					<button type="button" onclick={resume}>▶ Resume research</button>
					<button type="button" class="ghost" onclick={() => goto('/deepresearch')}
						>New research</button
					>
				</div>
			{:else}
				<div class="spinner" aria-hidden="true"></div>
				<p class="msg muted">Thinking… {state.searchesUsed}/{state.maxSearches} searches used</p>
				{#if thoughts.length}
					<ul class="thoughts">
						{#each thoughts as th, idx (idx)}
							<li class="thought {th.k}">
								<span class="tag">{th.k}</span>
								<span class="txt">{th.c}</span>
								{#if th.cost}
									<span class="stepcost">${th.cost.toFixed(6)}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		{:else if state?.status === 'complete'}
			<section class="result">
				<div class="bar">
					<span class="cost">
						{state.searchesUsed} searches
						{#if state.total_cost}
							· LLM {fmtCost(state.llm_cost)} · Search {fmtCost(state.search_cost)} · Total {fmtCost(state.total_cost)}
						{/if}
					</span>
					<button type="button" onclick={download}>Download .md</button>
					<button type="button" class="ghost" onclick={() => goto('/deepresearch')}
						>New research</button
					>
				</div>
				<article class="md">{@html String(marked.parse(state.answer))}</article>
			</section>
		{:else}
			<div class="spinner" aria-hidden="true"></div>
			<p class="msg muted">Loading…</p>
		{/if}
		{#if errors.length}
			<section class="errors">
				<h2>Errors{errors.filter((e) => e.attempt < (state?.maxRetries ?? 9)).length ? ' (recovered)' : ''}</h2>
				<ul>
					{#each errors as e, idx (idx)}
						<li class="err-item">
							<span class="err-tag" class:recovered={e.attempt < (state?.maxRetries ?? 9)} class:fatal={e.attempt >= (state?.maxRetries ?? 9)}>
								{e.attempt < (state?.maxRetries ?? 9) ? 'recovered' : 'fatal'}
							</span>
							<span class="err-msg">turn {e.turn} / try {e.attempt + 1}: {e.message}</span>
							{#if e.detail}
								<details>
									<summary>details</summary>
									<pre>{e.detail}</pre>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</section>
</main>

<style>
	.back {
		margin-top: 1rem;
	}
	.status {
		text-align: left;
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
	.msg {
		text-align: left;
		margin: 1.2rem 0;
		font-size: 0.98rem;
	}
	.msg.error {
		color: #dc2626;
	}
	.msg.paused {
		color: #d97706;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-start;
		margin-top: 0.4rem;
	}
	.actions .ghost {
		height: 3rem;
		padding: 0 1.4rem;
	}
	.msg.muted {
		color: #94a3b8;
	}
	.thoughts {
		list-style: none;
		margin: 1.6rem 0 0;
		padding: 0;
		text-align: left;
		max-width: 38rem;
		margin-inline: 0;
		display: grid;
		gap: 0.5rem;
	}
	.thought {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		padding: 0.5rem 0.7rem;
		background: #f7f9fc;
		border: 1px solid #e4e9f2;
		border-radius: 9px;
		font-size: 0.9rem;
		color: #334155;
		line-height: 1.45;
	}
	.thought .tag {
		flex: none;
		text-transform: uppercase;
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		font-weight: 700;
		padding: 0.1rem 0.4rem;
		border-radius: 5px;
		color: #fff;
	}
	.thought.think .tag {
		background: #6366f1;
	}
	.thought.search .tag {
		background: #0891b2;
	}
	.thought.verses .tag {
		background: #059669;
	}
	.thought.finish .tag {
		background: #d97706;
	}
	.thought .txt {
		word-break: break-word;
	}
	.stepcost {
		margin-left: auto;
		flex: none;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: #64748b;
		font-weight: 600;
		white-space: nowrap;
	}
	.thought.think .stepcost,
	.thought.finish .stepcost {
		color: #4f46e5;
	}
	.thought.search .stepcost,
	.thought.verses .stepcost {
		color: #0891b2;
	}
	.result {
		margin-top: 2rem;
	}
	.bar {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		align-items: center;
		margin-bottom: 1.2rem;
	}
	.cost {
		margin-right: auto;
		font-size: 0.85rem;
		color: #475569;
		font-weight: 600;
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
	.md :global(table) {
		display: block;
		width: 100%;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		margin: 1.3rem 0;
		font-size: 0.92rem;
	}
	.md :global(th),
	.md :global(td) {
		border: 1px solid #e4e9f2;
		padding: 0.5rem 0.7rem;
		text-align: left;
		vertical-align: top;
		line-height: 1.5;
	}
	.md :global(thead th) {
		background: #f4f7fc;
		color: #16233f;
		font-weight: 600;
	}
	.md :global(tbody tr:nth-child(even)) {
		background: #f7f9fc;
	}
	.errors {
		margin-top: 2rem;
	}
	.errors h2 {
		font-size: 0.92rem;
		color: #dc2626;
		margin: 0 0 0.6rem;
		font-weight: 600;
	}
	.errors ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.err-item {
		font-size: 0.85rem;
		padding: 0.5rem 0.7rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 9px;
		color: #991b1b;
		line-height: 1.45;
	}
	.err-tag {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.1rem 0.35rem;
		border-radius: 5px;
		margin-right: 0.4rem;
		color: #fff;
	}
	.err-tag.recovered {
		background: #d97706;
	}
	.err-tag.fatal {
		background: #dc2626;
	}
	.err-item details {
		margin-top: 0.3rem;
	}
	.err-item summary {
		cursor: pointer;
		font-size: 0.78rem;
		color: #b91c1c;
		opacity: 0.7;
	}
	.err-item pre {
		margin: 0.3rem 0 0;
		font-size: 0.72rem;
		white-space: pre-wrap;
		word-break: break-word;
		background: #fef2f2;
		padding: 0.4rem;
		border-radius: 5px;
		max-height: 12rem;
		overflow: auto;
	}
</style>
