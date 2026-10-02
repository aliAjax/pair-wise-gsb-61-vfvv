<script setup lang="ts">
import type { SupplementTokenStatus } from '~/types/certification';

const props = defineProps<{ status: SupplementTokenStatus }>();

const labels: Record<SupplementTokenStatus, string> = {
  draft: '填写中',
  stale: '待核对',
  submitting: '提交中',
  failed: '提交失败',
  completed: '已完成凭据'
};

const colors: Record<SupplementTokenStatus, 'gray' | 'amber' | 'blue' | 'red' | 'green'> = {
  draft: 'gray',
  stale: 'amber',
  submitting: 'blue',
  failed: 'red',
  completed: 'green'
};
</script>

<template>
  <UBadge :color="colors[props.status]" variant="soft">{{ labels[props.status] }}</UBadge>
</template>
