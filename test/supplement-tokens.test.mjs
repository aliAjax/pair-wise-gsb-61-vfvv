// 补件凭据核心场景逻辑验证（node:test + esbuild 即时打包）
import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';

const STORAGE_V2 = 'vehicle-type-approval-projects-v2';
const listeners = new Set();

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

const storageA = makeStorage();
const storageB = makeStorage();

const tmpFiles = [];

async function loadStore(storage) {
  const suffix = Math.random().toString(36).slice(2);
  const entryPath = `test/.tmp-entry-${suffix}.mjs`;
  const outPath = `test/.tmp-bundle-${suffix}.mjs`;
  tmpFiles.push(entryPath, outPath);
  writeFileSync(entryPath, "export { createPinia, setActivePinia } from 'pinia';\nexport * from '../stores/certification.ts';\n");
  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: outPath,
    logLevel: 'silent'
  });
  globalThis.localStorage = storage;
  const mod = await import(pathToFileURL(outPath).href + '?t=' + Date.now());
  mod.setActivePinia(mod.createPinia());
  const store = mod.useCertificationStore();
  store.hydrate();
  return { store, mod };
}

test.after(() => {
  for (const f of tmpFiles) {
    try { rmSync(f); } catch {}
  }
});

/** 模拟 B 标签页持久化后向 A 广播 storage 事件 */
function broadcast(fromStorage, toStorage) {
  const raw = fromStorage.getItem(STORAGE_V2);
  if (!raw) return;
  // 让 B 的本地 map 与 A 共享同一物理存储（模拟同域 localStorage）
  toStorage._map.set(STORAGE_V2, raw);
}

const PID = 'TA-2026-118';

test('场景1：记住基线 → 提交成功；重复提交幂等，不再次推进证据', async () => {
  const { store } = await loadStore(storageA);
  const project = () => store.projectById(PID);
  const initialCount = project().evidence.filter((e) => ['rejected', 'resubmit', 'missing'].includes(e.status)).length;

  const ids = project()
    .evidence.filter((e) => ['rejected', 'resubmit'].includes(e.status))
    .map((e) => e.id);
  const tokenId = store.openSupplementToken(PID, '申请人甲', ids, '已完成补测并更新到 8.4.1 基线');
  store.armSupplementToken(tokenId);

  const outcome = await store.commitSupplementToken(tokenId);
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.applied.length, ids.length);

  const token = project().supplementTokens.find((t) => t.id === tokenId);
  assert.equal(token.status, 'complete');
  // 证据已推进并挂到已完成凭据
  for (const id of ids) {
    const ev = project().evidence.find((e) => e.id === id);
    assert.equal(ev.status, 'submitted');
    assert.equal(ev.supplementTokenId, tokenId);
  }
  // 待补件数量减少
  const afterCount = project().evidence.filter((e) => ['rejected', 'resubmit', 'missing'].includes(e.status)).length;
  assert.equal(afterCount, initialCount - ids.length);

  // 重复提交：幂等空操作
  const again = await store.commitSupplementToken(tokenId);
  assert.equal(again.status, 'complete');
  assert.equal(again.applied.length, ids.length);
  const updatedAt = project().evidence.find((e) => e.id === ids[0]).updatedAt;
  // 审计只有一条补件记录
  const supplementAudits = project().audit.filter((a) => a.supplementTokenId === tokenId);
  assert.equal(supplementAudits.length, 1);
  assert.ok(updatedAt);
});

test('场景2：凭据记住基线后，另一标签页改基线 → 旧凭据立即失效停在待核对，已选与说明保留', async () => {
  // 新存储，两个标签页共享
  const shared = makeStorage();
  const a = await loadStore(shared);
  const b = await loadStore(shared);

  const idsA = a.store.projectById(PID).evidence.filter((e) => e.status === 'resubmit').map((e) => e.id);
  const tokenId = a.store.openSupplementToken(PID, '甲', idsA, '甲的补件说明需要保留');
  a.store.armSupplementToken(tokenId);

  // B 标签页改基线（维护版本/软件版本）
  const pB = b.store.projectById(PID);
  b.store.updateProject(PID, {
    name: pB.name,
    modelCode: pB.modelCode,
    vehicleType: pB.vehicleType,
    configuration: pB.configuration,
    maintenanceVersion: 'MY27.2',
    softwareVersion: pB.softwareVersion,
    applicant: pB.applicant,
    agency: pB.agency,
    certificateExpiry: pB.certificateExpiry
  }, '另一标签页升级维护版本');

  // 物理存储同步到 A 后，A 主动读取并合并（模拟 storage 事件到达）
  shared._map.set(STORAGE_V2, b.store.$state ? JSON.stringify({ version: 2, projects: b.store.projects, savedAt: new Date().toISOString() }) : '');
  const raw = shared.getItem(STORAGE_V2);
  const incoming = JSON.parse(raw);
  a.store.mergeIncoming(incoming);

  const tokenA = a.store.projectById(PID).supplementTokens.find((t) => t.id === tokenId);
  assert.equal(tokenA.status, 'pending_check');
  assert.deepEqual(tokenA.selectedEvidenceIds, idsA);
  assert.equal(tokenA.note, '甲的补件说明需要保留');
  assert.ok(tokenA.pendingReason.length > 0);

  // 待核对凭据不能提交
  const blocked = await a.store.commitSupplementToken(tokenId);
  assert.equal(blocked.status, 'pending_check');

  // 核对后续办 → ready → 可提交成功
  a.store.armSupplementToken(tokenId);
  assert.equal(a.store.projectById(PID).supplementTokens.find((t) => t.id === tokenId).status, 'ready');
  const outcome = await a.store.commitSupplementToken(tokenId);
  assert.equal(outcome.status, 'complete');
});

test('场景3：提交逐项 CAS，不覆盖别人刚接受的结果；重复凭据不重复推进', async () => {
  const shared = makeStorage();
  const a = await loadStore(shared);
  const b = await loadStore(shared);

  const idsA = a.store.projectById(PID).evidence.filter((e) => ['rejected', 'resubmit'].includes(e.status)).map((e) => e.id);
  const tokenA = a.store.openSupplementToken(PID, '甲', idsA, '甲提交的补件说明足够长');
  a.store.armSupplementToken(tokenA);

  // 模拟 A 提交在途（600ms）期间，B 在已含 A 草稿的共享存储上抢先接受了其中一项
  const inFlight = a.store.commitSupplementToken(tokenA);
  await new Promise((r) => setTimeout(r, 50));
  const acceptedId = idsA[0];
  // 物理存储先同步 A 已持久化的 ready 凭据（浏览器里两个标签页共享同一 localStorage）
  shared._map.set(
    STORAGE_V2,
    JSON.stringify({ version: 2, projects: a.store.projects, savedAt: new Date().toISOString() })
  );
  // B 从最新存储合并后再只改一项证据状态（不覆盖 A 的凭据）
  b.store.mergeIncoming(JSON.parse(shared.getItem(STORAGE_V2)));
  b.store.updateEvidence(PID, acceptedId, 'accepted', '审阅人在另一标签页接受');
  shared._map.set(
    STORAGE_V2,
    JSON.stringify({ version: 2, projects: b.store.projects, savedAt: new Date().toISOString() })
  );
  const outcome = await inFlight;

  assert.equal(outcome.status, 'complete');
  const appliedIds = outcome.applied.map((c) => c.evidenceId);
  assert.ok(!appliedIds.includes(acceptedId), '已被接受的证据不能被补件覆盖');
  const skippedIds = outcome.skipped.map((c) => c.evidenceId);
  assert.ok(skippedIds.includes(acceptedId));
  // B 接受的结果保留
  const ev = a.store.projectById(PID).evidence.find((e) => e.id === acceptedId);
  assert.equal(ev.status, 'accepted');
  assert.equal(ev.supplementTokenId, undefined);
});

test('场景4：失败注入后凭据保留，重试只推进未落账项', async () => {
  const shared = makeStorage();
  const a = await loadStore(shared);

  const ids = a.store.projectById(PID).evidence.filter((e) => ['rejected', 'resubmit'].includes(e.status)).map((e) => e.id);
  assert.ok(ids.length >= 2, '种子数据至少有两项待补件');
  const tokenId = a.store.openSupplementToken(PID, '甲', ids, '失败恢复测试用的补件说明文本');
  a.store.armSupplementToken(tokenId);
  a.store.armFailureInjection();

  const failed = await a.store.commitSupplementToken(tokenId);
  assert.ok(failed.error);
  const tokenAfterFail = a.store.projectById(PID).supplementTokens.find((t) => t.id === tokenId);
  assert.notEqual(tokenAfterFail.status, 'complete');
  assert.ok(tokenAfterFail.applied.length >= 1, '已有部分逐项落账');
  const appliedCount = tokenAfterFail.applied.length;

  // 重试：从最后一个完整凭据之后继续，已落账项不重复推进
  const retry = await a.store.commitSupplementToken(tokenId);
  assert.equal(retry.status, 'complete');
  const tokenDone = a.store.projectById(PID).supplementTokens.find((t) => t.id === tokenId);
  assert.equal(tokenDone.status, 'complete');
  const uniqueApplied = new Set(tokenDone.applied.map((c) => c.evidenceId));
  assert.equal(uniqueApplied.size, tokenDone.applied.length, '落账项不重复');
});

test('场景5：法规覆盖与审计导出只认已完成凭据', async () => {
  const shared = makeStorage();
  const a = await loadStore(shared);

  const ids = a.store.projectById(PID).evidence.filter((e) => e.status === 'rejected').map((e) => e.id);
  const tokenId = a.store.openSupplementToken(PID, '甲', ids, '只完成部分流程的补件说明文本');
  a.store.armSupplementToken(tokenId);
  // 失败注入：证据状态已部分推进但凭据未完成
  a.store.armFailureInjection();
  await a.store.commitSupplementToken(tokenId);

  const project = a.store.projectById(PID);
  const tokenAfterFail = project.supplementTokens.find((t) => t.id === tokenId);
  assert.ok(tokenAfterFail.applied.length >= 1, '失败注入下 rejected 证据已逐项落账');
  const appliedEvidenceIds = tokenAfterFail.applied.map((c) => c.evidenceId);

  // 未完成凭据：已落账证据不进入有效证据（覆盖）
  const effective = a.store.effectiveEvidence(project);
  assert.equal(
    effective.filter((e) => appliedEvidenceIds.includes(e.id)).length,
    0,
    '未完成凭据的证据不进入有效证据（覆盖）'
  );

  const effectiveAudit = a.store.effectiveAudit(project);
  assert.ok(!effectiveAudit.some((e) => e.supplementTokenId === tokenId), '未完成凭据的审计条目不被导出认定');

  // 完成后即生效
  await a.store.commitSupplementToken(tokenId);
  const project2 = a.store.projectById(PID);
  const effective2 = a.store.effectiveEvidence(project2);
  assert.ok(effective2.some((e) => e.supplementTokenId === tokenId), '完成后证据生效');
  const audit2 = a.store.effectiveAudit(project2);
  assert.ok(audit2.some((e) => e.supplementTokenId === tokenId), '完成后审计条目不生效');
});
