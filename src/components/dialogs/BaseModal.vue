<script setup lang="ts">
import { onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{
  title: string;
  wide?: boolean;
}>(), { wide: false });

const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();

onMounted(() => dialog.value?.showModal());

function handleBackdrop(event: MouseEvent): void {
  if (event.target !== dialog.value || !dialog.value) return;
  const bounds = dialog.value.getBoundingClientRect();
  const outside = event.clientX < bounds.left
    || event.clientX > bounds.right
    || event.clientY < bounds.top
    || event.clientY > bounds.bottom;
  if (outside) dialog.value.close();
}
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
    :class="{ wide }"
    aria-labelledby="dialog-title"
    @close="emit('close')"
    @click="handleBackdrop"
  >
    <div class="modal-heading">
      <div><span class="eyebrow">COMMONWEALTH</span><h2 id="dialog-title">{{ props.title }}</h2></div>
      <button class="close-button" aria-label="Close dialog" @click="dialog?.close()">×</button>
    </div>
    <div class="modal-body"><slot /></div>
  </dialog>
</template>
