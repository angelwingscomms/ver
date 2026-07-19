import type { Msg, RetryError } from './core';

export const DB_NAME = 'ver-dr';
export const STORE = 'research';
export const KEY_STORE = 'settings';
export const DB_VERSION = 3;

export type ResearchState = {
	id: string;
	question: string;
	maxSearches: number;
	maxRetries: number;
	status: 'running' | 'complete' | 'error' | 'paused';
	messages: Msg[];
	searchesUsed: number;
	turn: number;
	thoughtLog: { k: string; n: number; c: string; cost?: number; cost_kind?: 'llm' | 'search' }[];
	errors: RetryError[];
	answer: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
	llm_cost?: number;
	search_cost?: number;
	total_cost?: number;
};

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE))
				db.createObjectStore(STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(KEY_STORE))
				db.createObjectStore(KEY_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function saveResearch(s: ResearchState): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(s);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function loadResearch(id: string): Promise<ResearchState | undefined> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).get(id);
		req.onsuccess = () => resolve(req.result ?? undefined);
		req.onerror = () => reject(req.error);
	});
}

export async function listResearch(): Promise<ResearchState[]> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).getAll();
		req.onsuccess = () => {
			const all: ResearchState[] = req.result ?? [];
			all.sort((a, b) => b.createdAt - a.createdAt);
			resolve(all);
		};
		req.onerror = () => reject(req.error);
	});
}

export async function deleteResearch(id: string): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).delete(id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function saveKey(key: string): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, 'readwrite');
		tx.objectStore(KEY_STORE).put(key, 'openrouter_key');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function loadKey(): Promise<string | undefined> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, 'readonly');
		const req = tx.objectStore(KEY_STORE).get('openrouter_key');
		req.onsuccess = () => resolve(req.result ?? undefined);
		req.onerror = () => reject(req.error);
	});
}
