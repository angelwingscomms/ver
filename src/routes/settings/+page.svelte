<script lang="ts">
	import { browser } from '$app/environment';
	import {
		loadSetting,
		saveSetting,
		loadKey,
		saveKey
	} from '$lib/deepresearch/sw-db';
	import { MODEL, GEMINI_MODEL } from '$lib/deepresearch/core';
	import ChatgptConnect from '$lib/components/chatgpt_connect.svelte';

	let provider = $state('openrouter');
	let openrouterKey = $state('');
	let geminiKey = $state('');
	let selectedModel = $state('');
	let models = $state<{ id: string; name: string }[]>([]);
	let loadingModels = $state(false);
	let saved = $state(false);
	let modelError = $state('');

	$effect(() => {
		if (!browser) return;
		Promise.all([
			loadSetting('provider'),
			loadKey(),
			loadSetting('gemini_key'),
			loadSetting('model')
		]).then(([p, ok, gk, m]) => {
			if (p) provider = p;
			if (ok) openrouterKey = ok;
			if (gk) geminiKey = gk;
			if (m) selectedModel = m;
			else selectedModel = p === 'gemini' ? GEMINI_MODEL : MODEL;
		});
	});

	$effect(() => {
		if (!browser) return;
		loadModels();
	});

	async function loadModels() {
		modelError = '';
		loadingModels = true;
		models = [];
		try {
			if (provider === 'gemini') {
				const k = geminiKey.trim();
				if (!k) {
					modelError = 'Enter your Gemini API key first.';
					return;
				}
				const res = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`
				);
				if (!res.ok) {
					modelError = `Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`;
					return;
				}
				const j = (await res.json()) as { models: { name: string; displayName: string }[] };
				models = (j.models || [])
					.filter((m) => m.name.startsWith('models/gemini-') && !m.name.includes('-pro-vision'))
					.map((m) => ({ id: m.name.replace('models/', ''), name: m.displayName }));
			} else {
				const res = await fetch('https://openrouter.ai/api/v1/models');
				if (!res.ok) {
					modelError = `OpenRouter API ${res.status}: ${(await res.text()).slice(0, 200)}`;
					return;
				}
				const j = (await res.json()) as { data: { id: string; name?: string }[] };
				models = (j.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
			}
			if (models.length && !models.find((m) => m.id === selectedModel)) {
				selectedModel = models[0].id;
			}
		} catch (e) {
			modelError = String(e);
		} finally {
			loadingModels = false;
		}
	}

	function currentKey() {
		return provider === 'gemini' ? geminiKey.trim() : openrouterKey.trim();
	}

	async function save() {
		await Promise.all([
			saveSetting('provider', provider),
			saveKey(openrouterKey.trim()),
			saveSetting('gemini_key', geminiKey.trim()),
			saveSetting('model', selectedModel)
		]);
		saved = true;
		setTimeout(() => (saved = false), 2000);
	}
</script>

<svelte:head>
	<title>Settings — Ver</title>
</svelte:head>

<main>
	<header class="hero">
		<h1>Settings</h1>
		<p class="lede">
			Choose your LLM provider and enter the corresponding API key to run deep research in your
			browser. Keys are stored on this device only.
		</p>
	</header>

	<form onsubmit={(e) => { e.preventDefault(); save(); }}>
		<label class="field">
			<span>Provider</span>
			<select bind:value={provider} aria-label="LLM provider">
				<option value="openrouter">OpenRouter</option>
				<option value="gemini">Gemini (Google)</option>
			</select>
		</label>

		{#if provider === 'openrouter'}
			<label class="field">
				<span>OpenRouter API Key</span>
				<input
					type="password"
					bind:value={openrouterKey}
					placeholder="sk-or-v1-..."
					aria-label="OpenRouter API key"
				/>
			</label>
		{:else}
			<label class="field">
				<span>Gemini API Key</span>
				<input
					type="password"
					bind:value={geminiKey}
					placeholder="AIza..."
					aria-label="Gemini API key"
				/>
			</label>
		{/if}

		<label class="field">
			<span>Model</span>
			<div class="model-row">
				<select bind:value={selectedModel} aria-label="Model">
					{#each models as m}
						<option value={m.id}>{m.name || m.id}</option>
					{/each}
				</select>
				<button type="button" disabled={loadingModels} onclick={loadModels}>
					{loadingModels ? 'Loading…' : 'Reload models'}
				</button>
			</div>
			{#if modelError}
				<p class="err">{modelError}</p>
			{/if}
			{#if !models.length && !loadingModels && !modelError}
				<p class="hint">Click "Reload models" to fetch the available models for {provider}.</p>
			{/if}
		</label>

		<div class="row">
			<button type="submit">Save</button>
			{#if saved}<span class="saved">Saved</span>{/if}
		</div>
	</form>

	<section class="form cg-card">
		<h2>chatgpt plan</h2>
		<p class="lede">
			Connect a ChatGPT account so API deep research runs on that plan. Usage counts against
			the connected ChatGPT account, not your Ver token balance.
		</p>
		<ChatgptConnect />
	</section>

	{#if provider === 'openrouter'}
		<p class="hint">
			<a href="https://openrouter.ai/keys" target="_blank" rel="noopener">Get an OpenRouter key</a>
			— $1 credit included with signup.
		</p>
	{:else}
		<p class="hint">
			<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"
				>Get a Gemini API key</a
			>
			— free tier includes generous daily limits.
		</p>
	{/if}
</main>

<style>
	.lede {
		margin: 0.75rem 0 0;
		max-width: 34rem;
		color: #475569;
		font-size: 1.05rem;
		line-height: 1.5;
	}
	form {
		display: grid;
		gap: 1rem;
		background: #fff;
		padding: 1.5rem;
		border: 1px solid #dbe3f0;
		border-radius: 14px;
		box-shadow: 0 1px 2px rgba(22, 35, 63, 0.04), 0 12px 30px -18px rgba(22, 35, 63, 0.25);
	}
	.field {
		display: grid;
		gap: 0.4rem;
		font-size: 0.92rem;
		font-weight: 600;
		color: #16233f;
	}
	.field select,
	.field input {
		padding: 0.7rem 0.9rem;
		font-size: 1rem;
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
	}
	.field input {
		font-family: monospace;
	}
	.field select:focus,
	.field input:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}
	.model-row {
		display: flex;
		gap: 0.5rem;
	}
	.model-row select {
		flex: 1;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.saved {
		color: #059669;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.hint {
		margin-top: 1rem;
		font-size: 0.88rem;
		color: #64748b;
	}
	.err {
		font-size: 0.82rem;
		color: #dc2626;
		font-weight: 400;
	}
	.cg-card {
		display: grid;
		gap: 0.8rem;
		align-content: start;
	}
	.cg-card h2 {
		margin: 0;
		font-size: 1rem;
	}
</style>
