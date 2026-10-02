import { seedProjects } from '~/data/seed';
import type { ApprovalProject } from '~/types/certification';

const STORAGE_KEY = 'vehicle-type-approval-projects-v2';
const LEGACY_STORAGE_KEY = 'vehicle-type-approval-projects-v1';

interface StoredState {
  version: 2;
  projects: ApprovalProject[];
}

function currentProjects(): ApprovalProject[] {
  if (typeof localStorage === 'undefined') return structuredClone(seedProjects);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState;
      if (parsed.version === 2 && Array.isArray(parsed.projects)) return parsed.projects;
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return JSON.parse(legacy) as ApprovalProject[];
  } catch {
    return structuredClone(seedProjects);
  }
  return structuredClone(seedProjects);
}

export const mockFetch: typeof fetch = async (input) => {
  const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(source, 'http://local.test');
  await new Promise((resolve) => setTimeout(resolve, 70));

  const send = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json'
      }
    });

  if (url.pathname === '/api/projects') {
    return send(currentProjects());
  }

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (match) {
    const project = currentProjects().find((item) => item.id === decodeURIComponent(match[1]));
    return project ? send(project) : send({ message: '项目不存在' }, 404);
  }

  return send({ message: '未实现的模拟接口' }, 404);
};
