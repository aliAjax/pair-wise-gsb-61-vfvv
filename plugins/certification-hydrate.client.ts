import { useCertificationStore } from '~/stores/certification';

// 客户端启动即载入 localStorage 中的项目与补件凭据，保证跨页面一致。
export default defineNuxtPlugin(() => {
  const store = useCertificationStore();
  store.hydrate();
});
