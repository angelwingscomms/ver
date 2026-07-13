<script lang="ts">
	import { marked } from 'marked';
	import { slug } from '$lib/deepresearch/core';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	type O = { q: string; m: string };
	type T = { k: string; n: number; c: string };
	let s = $state('');
	let o = $state<O | null>(null);
	let thoughts = $state<T[]>([]);
	let msg = $state('');
	let retries = $state(0);
	const MAX_RETRIES = 3;
	const TRANSIENT = /not found|running locally|fetch failed|5\d\d/i;
	let timer: ReturnType<typeof setInterval> | undefined;

	const id = $derived(page.params.id);
	const l = $derived(page.url.searchParams.get('l') ?? '');
	const q = $derived(page.url.searchParams.get('q') ?? '');

	async function poll() {
		const i = id;
		const ll = l;
		if (!i) return;
		try {
			const res = await fetch(`/api/deepresearch/${i}${ll ? `?l=${encodeURIComponent(ll)}` : ''}`);
			if (!res.ok) {
				stop_poll();
				msg = res.status === 404 ? 'research not found (it may have expired)' : 'status check failed';
				return;
			}
			const d = (await res.json()) as { s: string; o: O | null; e: unknown; t: T[] };
			s = d.s;
			thoughts = (d.t ?? []).slice().sort((a, b) => a.n - b.n);
			if (d.s === 'complete') {
				o = d.o;
				stop_poll();
			} else if (d.s === 'errored' || d.s === 'terminated') {
				stop_poll();
				const err = d.e ? `: ${JSON.stringify(d.e)}` : '';
				if (TRANSIENT.test(err) && retries < MAX_RETRIES) {
					retries++;
					msg = `transient error (${d.s})${err} — retry the run from the list`;
				} else {
					msg = `research ${d.s}${err}`;
				}
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
		if (id && !o) {
			poll();
			timer = setInterval(poll, 5000);
		}
		return stop_poll;
	});

	function download() {
		if (!o) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([o.m], { type: 'text/markdown' }));
		a.download = `${slug(o.q)}.md`;
		a.click();
		URL.revokeObjectURL(a.href);
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
		{#if msg}
			<p class="msg">{msg}</p>
			<div class="actions">
				<button type="button" onclick={() => { retries = 0; msg = ''; poll(); timer = setInterval(poll, 5000); }}
					>Retry</button
				>
				<button type="button" class="ghost" onclick={() => goto('/deepresearch')}>New research</button>
			</div>
		{:else if !o}
			<div class="spinner" aria-hidden="true"></div>
			<p class="msg muted">Researching… status: {s || 'starting'}</p>
			{#if thoughts.length}
				<ul class="thoughts">
					{#each thoughts as th, idx (idx)}
						<li class="thought {th.k}">
							<span class="tag">{th.k}</span>
							<span class="txt">{th.c}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<section class="result">
				<div class="bar">
					<button type="button" onclick={download}>Download .md</button>
					<button type="button" class="ghost" onclick={() => goto('/deepresearch')}
						>New research</button
					>
				</div>
				<article class="md">{@html String(marked.parse(o.m))}</article>
			</section>
		{/if}
	</section>
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
	.back {
		margin-top: 1rem;
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
	.actions {
		display: flex;
		gap: 0.6rem;
		justify-content: center;
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
		margin-inline: auto;
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
</style>
