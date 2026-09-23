import { createApp } from 'vue';
import './style.css';

async function mount(): Promise<void> {
  const devMode = new URLSearchParams(window.location.search).has('dev');
  const component = devMode
    ? (await import('./dev/DevApp.vue')).default
    : (await import('./App.vue')).default;

  createApp(component).mount('#app');
}

void mount();
