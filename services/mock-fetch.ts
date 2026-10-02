import {
  createToken as ledgerCreateToken,
  readProjects,
  rebaseToken as ledgerRebaseToken,
  saveDraft as ledgerSaveDraft,
  submitToken as ledgerSubmitToken,
  TokenConflictError
} from './supplement-ledger';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export const mockFetch: typeof fetch = async (input, init) => {
  const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(source, 'http://local.test');
  await new Promise((resolve) => setTimeout(resolve, 70));

  const send = (data: unknown, status = 200) => jsonResponse(data, status);

  if (url.pathname === '/api/projects' && (!init?.method || init.method === 'GET')) {
    return send(readProjects());
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && (!init?.method || init.method === 'GET')) {
    const project = readProjects().find((item) => item.id === decodeURIComponent(projectMatch[1]));
    return project ? send(project) : send({ message: '项目不存在' }, 404);
  }

  // 补件凭据接口 ---------------------------------------------
  const tokenCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/supplement-tokens$/);
  if (tokenCollectionMatch && init?.method === 'POST') {
    const projectId = decodeURIComponent(tokenCollectionMatch[1]);
    try {
      return send(ledgerCreateToken(projectId));
    } catch (error) {
      return send({ message: error instanceof Error ? error.message : '创建凭据失败' }, 404);
    }
  }

  const tokenMatch = url.pathname.match(/^\/api\/projects\/[^/]+\/supplement-tokens\/([^/]+)$/);
  if (tokenMatch) {
    const tokenId = decodeURIComponent(tokenMatch[1]);
    const method = init?.method ?? 'GET';
    try {
      if (method === 'PUT') {
        const body = await readBody<{ selectedEvidenceIds?: string[]; note?: string }>(init as Request);
        const updated = ledgerSaveDraft(
          tokenId,
          Array.isArray(body.selectedEvidenceIds) ? body.selectedEvidenceIds : [],
          typeof body.note === 'string' ? body.note : ''
        );
        return send(updated);
      }
      if (method === 'POST' && url.searchParams.get('action') === 'rebase') {
        return send(ledgerRebaseToken(tokenId));
      }
      if (method === 'POST' && url.searchParams.get('action') === 'submit') {
        const body = await readBody<{ actor?: string; simulateFailure?: boolean }>(init as Request);
        const result = ledgerSubmitToken(tokenId, body.actor ?? '申请人', Boolean(body.simulateFailure));
        return send(result);
      }
      return send({ message: '未实现的凭据操作' }, 404);
    } catch (error) {
      if (error instanceof TokenConflictError) {
        const status = error.code === 'stale_baseline' ? 409 : 400;
        return send({ message: error.message, code: error.code }, status);
      }
      if (error instanceof Error) {
        // 模拟的提交失败：服务端 502，凭据保留可重试。
        return send({ message: error.message }, 502);
      }
      return send({ message: '凭据操作失败' }, 500);
    }
  }

  return send({ message: '未实现的模拟接口' }, 404);
};
