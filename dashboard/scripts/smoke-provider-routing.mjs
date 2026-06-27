import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.AGENTMA_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'agentma-provider-routing-'));

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  },
});

const {
  createProviderProfile,
  listProviderModels,
  mergeProviderProfiles,
  resolveProviderForModel,
  saveProviderProfiles,
} = await import('../src/utils/providers.ts');
const {
  registerUser,
  replaceProviderProfiles,
  resolveProviderProfileForModel,
} = await import('../server-store.ts');

saveProviderProfiles([
  createProviderProfile({
    id: 'deepseek',
    name: 'DeepSeek',
    ANTHROPIC_AUTH_TOKEN: 'deepseek-key',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    enabled: true,
    isDefault: true,
  }),
  createProviderProfile({
    id: 'minimax',
    name: 'MiniMax',
    ANTHROPIC_AUTH_TOKEN: 'minimax-key',
    ANTHROPIC_BASE_URL: 'https://api.minimax.chat/anthropic',
    availableModels: ['MiniMax-M2.7-highspeed'],
    enabled: true,
  }),
]);

const models = listProviderModels();
assert.deepEqual(models, ['deepseek-v4-pro', 'deepseek-v4-flash', 'MiniMax-M2.7-highspeed']);

const minimax = resolveProviderForModel('MiniMax-M2.7-highspeed');
assert.equal(minimax.profile.id, 'minimax');
assert.equal(minimax.provider.ANTHROPIC_AUTH_TOKEN, 'minimax-key');
assert.equal(minimax.provider.ANTHROPIC_BASE_URL, 'https://api.minimax.chat/anthropic');
assert.equal(minimax.provider.ANTHROPIC_MODEL, 'MiniMax-M2.7-highspeed');

const deepseek = resolveProviderForModel('deepseek-v4-flash');
assert.equal(deepseek.profile.id, 'deepseek');
assert.equal(deepseek.provider.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');

const mergedProviders = mergeProviderProfiles([
  createProviderProfile({
    id: 'deepseek',
    name: 'DeepSeek',
    ANTHROPIC_AUTH_TOKEN: 'deepseek-key',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    availableModels: ['deepseek-v4-flash'],
    enabled: true,
    isDefault: true,
  }),
], [
  createProviderProfile({
    id: 'minimax',
    name: 'MiniMax',
    ANTHROPIC_AUTH_TOKEN: 'minimax-key',
    ANTHROPIC_BASE_URL: 'https://api.minimax.chat/anthropic',
    availableModels: ['MiniMax-M2.7-highspeed'],
    enabled: true,
  }),
]);
assert.deepEqual(mergedProviders.map(provider => provider.id), ['deepseek', 'minimax']);
assert.equal(mergedProviders.find(provider => provider.id === 'deepseek')?.isDefault, true);

const tenant = registerUser('Provider Smoke', 'provider-smoke@example.com', 'password123');
assert.equal(tenant.ok, true);
const tenantId = tenant.tenantId;

replaceProviderProfiles(tenantId, [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    ANTHROPIC_AUTH_TOKEN: 'deepseek-key',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    enabled: true,
    isDefault: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    ANTHROPIC_AUTH_TOKEN: 'minimax-key',
    ANTHROPIC_BASE_URL: 'https://api.minimax.chat/anthropic',
    availableModels: ['MiniMax-M2.7-highspeed'],
    enabled: true,
  },
]);

const serverMiniMax = resolveProviderProfileForModel(tenantId, 'MiniMax-M2.7-highspeed');
assert.equal(serverMiniMax?.id, 'minimax');
assert.equal(serverMiniMax?.ANTHROPIC_BASE_URL, 'https://api.minimax.chat/anthropic');

const serverUnknown = resolveProviderProfileForModel(tenantId, 'unknown-model');
assert.equal(serverUnknown, null);

console.log('provider routing smoke passed');
