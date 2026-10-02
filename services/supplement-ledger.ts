import type {
  ApprovalProject,
  BaselineSnapshot,
  EvidenceItem,
  SupplementToken
} from '~/types/certification';
import { seedProjects } from '~/data/seed';

const PROJECTS_KEY = 'vehicle-type-approval-projects-v1';
const TOKENS_KEY = 'vehicle-type-approval-supplement-tokens-v1';

export class TokenConflictError extends Error {
  code: 'stale_baseline' | 'not_found' | 'not_editable';
  constructor(code: TokenConflictError['code'], message: string) {
    super(message);
    this.name = 'TokenConflictError';
    this.code = code;
  }
}

function uid() {
  return `SUP-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 8)}`;
}

function auditId() {
  return `AUD-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8)}`;
}

export function baselineOf(project: ApprovalProject): BaselineSnapshot {
  return {
    maintenanceVersion: project.maintenanceVersion,
    softwareVersion: project.softwareVersion
  };
}

export function sameBaseline(a: BaselineSnapshot, b: BaselineSnapshot) {
  return a.maintenanceVersion === b.maintenanceVersion && a.softwareVersion === b.softwareVersion;
}

/* ------------------------------- 存储读写 ------------------------------- */

export function readProjects(): ApprovalProject[] {
  if (typeof localStorage === 'undefined') return structuredClone(seedProjects);
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as ApprovalProject[]) : structuredClone(seedProjects);
  } catch {
    return structuredClone(seedProjects);
  }
}

export function writeProjects(projects: ApprovalProject[]) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function readTokens(): SupplementToken[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as SupplementToken[]) : [];
  } catch {
    return [];
  }
}

export function writeTokens(tokens: SupplementToken[]) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

/* --------------------------- 同标签页响应式通知 --------------------------- */

type Listener = (projectId?: string) => void;
const listeners = new Set<Listener>();

export function onTokensChanged(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitTokensChanged(projectId?: string) {
  listeners.forEach((listener) => listener(projectId));
}

/**
 * 别的标签页写入 localStorage 时，触发本标签页的监听者。
 * 由客户端插件安装一次。
 */
export function installCrossTabSync(onProjectsChanged: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key === TOKENS_KEY) emitTokensChanged();
    if (event.key === PROJECTS_KEY) {
      // 基线可能被别的标签页修改：先统一核对凭据，再通知项目数据重载。
      reconcileStaleTokens();
      onProjectsChanged();
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/* ------------------------------- 核对失效 ------------------------------- */

/**
 * 项目基线发生变化后调用：把该项目所有未终结的凭据停在「待核对」。
 * 已完成 / 已失败的凭据是历史事实，不受影响；选择与说明原样保留。
 */
export function markStaleForProject(projectId: string, baseline: BaselineSnapshot) {
  const tokens = readTokens();
  let changed = false;
  for (const token of tokens) {
    if (
      token.projectId === projectId &&
      token.status !== 'completed' &&
      token.status !== 'stale' &&
      !sameBaseline(token.baseline, baseline)
    ) {
      token.status = 'stale';
      token.lastError = `项目基线已变更为 ${baseline.maintenanceVersion} / SW ${baseline.softwareVersion}，请核对后续办。`;
      token.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    writeTokens(tokens);
    emitTokensChanged(projectId);
  }
}

/** 存储事件触发的全量懒核对（别的标签页可能改了任意项目的基线）。 */
export function reconcileStaleTokens() {
  const projects = new Map(readProjects().map((project) => [project.id, baselineOf(project)]));
  const tokens = readTokens();
  let changed = false;
  for (const token of tokens) {
    const baseline = projects.get(token.projectId);
    if (
      baseline &&
      token.status !== 'completed' &&
      token.status !== 'stale' &&
      !sameBaseline(token.baseline, baseline)
    ) {
      token.status = 'stale';
      token.lastError = `项目基线已变更为 ${baseline.maintenanceVersion} / SW ${baseline.softwareVersion}，请核对后续办。`;
      token.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    writeTokens(tokens);
    emitTokensChanged();
  }
}

/* ------------------------------- 凭据生命周期 ------------------------------- */

function manifestOf(project: ApprovalProject) {
  return project.evidence.map((item) => ({
    id: item.id,
    regulationId: item.regulationId,
    name: item.name,
    status: item.status,
    softwareVersion: item.softwareVersion
  }));
}

export function tokensForProject(projectId: string) {
  return readTokens()
    .filter((token) => token.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function lastCompletedToken(projectId: string) {
  return tokensForProject(projectId).find((token) => token.status === 'completed');
}

export function activeToken(projectId: string) {
  return tokensForProject(projectId).find((token) => token.status !== 'completed');
}

/** 创建凭据：记住维护版本、软件版本与证据清单，默认从最后一张完整凭据续办。 */
export function createToken(projectId: string): SupplementToken {
  const project = readProjects().find((item) => item.id === projectId);
  if (!project) throw new TokenConflictError('not_found', '项目不存在');

  // 已有未终结凭据时直接复用，避免重复开单。
  const existing = activeToken(projectId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const token: SupplementToken = {
    id: uid(),
    projectId,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    baseline: baselineOf(project),
    manifest: manifestOf(project),
    selectedEvidenceIds: [],
    note: '',
    previousCompletedTokenId: lastCompletedToken(projectId)?.id
  };
  const tokens = readTokens();
  tokens.push(token);
  writeTokens(tokens);
  emitTokensChanged(projectId);
  return token;
}

/** 保存已选证据和说明；仅未终结凭据可写。 */
export function saveDraft(tokenId: string, selectedEvidenceIds: string[], note: string): SupplementToken {
  const tokens = readTokens();
  const token = tokens.find((item) => item.id === tokenId);
  if (!token) throw new TokenConflictError('not_found', '凭据不存在');
  if (token.status === 'completed') throw new TokenConflictError('not_editable', '凭据已完成');
  token.selectedEvidenceIds = [...new Set(selectedEvidenceIds)];
  token.note = note;
  token.updatedAt = new Date().toISOString();
  writeTokens(tokens);
  emitTokensChanged(token.projectId);
  return token;
}

/**
 * 核对后续办：以当前基线和最新证据清单生成新凭据，保留已选证据和说明。
 * 仅 stale 凭据可续办。
 */
export function rebaseToken(tokenId: string): SupplementToken {
  const tokens = readTokens();
  const stale = tokens.find((item) => item.id === tokenId);
  if (!stale) throw new TokenConflictError('not_found', '凭据不存在');
  if (stale.status !== 'stale') throw new TokenConflictError('not_editable', '仅待核对凭据可以核对续办');

  const project = readProjects().find((item) => item.id === stale.projectId);
  if (!project) throw new TokenConflictError('not_found', '项目不存在');

  const now = new Date().toISOString();
  const next: SupplementToken = {
    ...stale,
    id: uid(),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    baseline: baselineOf(project),
    manifest: manifestOf(project),
    lastError: undefined
  };
  tokens.push(next);
  writeTokens(tokens);
  emitTokensChanged(project.id);
  return next;
}

export interface SubmitResult {
  token: SupplementToken;
  applied: EvidenceItem[];
  skipped: EvidenceItem[];
}

/**
 * 原子提交补件凭据。
 *
 * - 基线不一致 → 凭据停在 stale，抛出 stale_baseline，证据不动。
 * - 重复提交同一凭据 → 返回首次结果，证据不重复推进（幂等）。
 * - 他人已接受的证据跳过，不覆盖其结果。
 * - simulateFailure=true 时模拟一次网络/服务失败：凭据留在 failed，证据不动，可原样重试。
 */
export function submitToken(tokenId: string, actor: string, simulateFailure = false): SubmitResult {
  // 凭据与项目在同一写事务内读取、校验、提交，模拟服务端原子操作。
  const projects = readProjects();
  const tokens = readTokens();
  const token = tokens.find((item) => item.id === tokenId);
  if (!token) throw new TokenConflictError('not_found', '凭据不存在');
  const project = projects.find((item) => item.id === token.projectId);
  if (!project) throw new TokenConflictError('not_found', '项目不存在');

  // 幂等：已完成的凭据重复提交直接回放首次结果。
  if (token.status === 'completed') {
    return {
      token,
      applied: project.evidence.filter((item) => token.appliedEvidenceIds?.includes(item.id)),
      skipped: project.evidence.filter((item) => token.skippedEvidenceIds?.includes(item.id))
    };
  }

  // 乐观并发控制：基线版本号必须匹配。
  if (!sameBaseline(token.baseline, baselineOf(project))) {
    token.status = 'stale';
    token.lastError = `项目基线已变更为 ${project.maintenanceVersion} / SW ${project.softwareVersion}，请核对后续办。`;
    token.updatedAt = new Date().toISOString();
    writeTokens(tokens);
    emitTokensChanged(token.projectId);
    throw new TokenConflictError('stale_baseline', '基线已被其他标签页修改，凭据已停在待核对');
  }

  if (simulateFailure) {
    token.status = 'failed';
    token.lastError = '提交失败（模拟网络错误）：证据未被推进，可直接重试。';
    token.updatedAt = new Date().toISOString();
    writeTokens(tokens);
    emitTokensChanged(token.projectId);
    throw new Error('提交失败：网络错误，凭据已保留，可从最后一个完整凭据续办。');
  }

  const applied: EvidenceItem[] = [];
  const skipped: EvidenceItem[] = [];
  const now = new Date().toISOString();

  for (const evidence of project.evidence) {
    if (!token.selectedEvidenceIds.includes(evidence.id)) continue;
    // 不覆盖他人刚接受的结果；已提交 / 已被其他凭据推进的也不重复推进。
    if (evidence.status === 'accepted' || evidence.submissionTokenId) {
      skipped.push(evidence);
      continue;
    }
    evidence.status = 'submitted';
    evidence.softwareVersion = project.softwareVersion;
    evidence.note = token.note || evidence.note;
    evidence.updatedAt = now;
    evidence.submissionTokenId = token.id;
    applied.push(evidence);
  }

  if (applied.length) {
    project.progress = Math.min(95, project.progress + applied.length * 4);
  }
  project.updatedAt = now;

  const skippedNames = skipped.map((item) => item.name).join('、') || '无';
  project.audit.unshift({
    id: auditId(),
    actor,
    action: '补件凭据提交',
    detail: `凭据 ${token.id}：推进 ${applied.length} 项证据至 SW ${project.softwareVersion}；跳过（他人已接受/已提交）${skipped.length} 项：${skippedNames}。${token.note}`,
    createdAt: now,
    supplementTokenId: token.id
  });

  token.status = 'completed';
  token.appliedEvidenceIds = applied.map((item) => item.id);
  token.skippedEvidenceIds = skipped.map((item) => item.id);
  token.completedAt = now;
  token.updatedAt = now;
  token.lastError = undefined;

  writeProjects(projects);
  writeTokens(tokens);
  emitTokensChanged(token.projectId);

  return { token, applied, skipped };
}
