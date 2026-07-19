<script lang="ts">
	import { browser } from '$app/environment';
	import { loadKey, saveKey } from '$lib/deepresearch/sw-db';

	let key = $state('');
	let saved = $state(false);

	$effect(() => {
		if (!browser) return;
		loadKey().then((k) => {
			if (k) key = k;
		});
	});

	async function save() {
		await saveKey(key.trim());
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
			Enter your OpenRouter API key to run deep research locally in your browser.
			The key is stored on this device only and never sent to our server.
		</p>
	</header>

	<form onsubmit={(e) => { e.preventDefault(); save(); }}>
		<label class="field">
			<span>OpenRouter API Key</span>
			<input
				type="password"
				bind:value={key}
				placeholder="sk-or-v1-..."
				aria-label="OpenRouter API key"
			/>
		</label>
		<div class="row">
			<button type="submit">Save</button>
			{#if saved}<span class="saved">Saved</span>{/if}
		</div>
	</form>

	<p class="hint">
		<a href="https://openrouter.ai/keys" target="_blank" rel="noopener">Get a free key</a>
		— $1 credit included with signup.
	</p>
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
	.field input {
		padding: 0.7rem 0.9rem;
		font-size: 1rem;
		font-family: monospace;
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
	}
	.field input:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
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
</style>
