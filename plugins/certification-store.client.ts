import { useCertificationStore } from '~/stores/certification';

// 客户端启用：水合本地状态并监听其他标签页对基线的改动
export default defineNuxtPlugin(() => {
  const store = useCertificationStore();
  store.hydrate();
  store.initCrossTabSync();
});
