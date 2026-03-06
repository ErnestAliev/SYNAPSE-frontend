import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import './assets/main.css';

// Prevent iOS Safari auto-zoom on input focus without forcing font-size: 16px.
// Works by temporarily adding maximum-scale=1 while an input is focused, then
// restoring the original viewport content on blur.
;(function preventIosInputZoom() {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return;
  const original = viewport.content;
  const locked = original.replace(/,?\s*maximum-scale=[^,]*/i, '') + ', maximum-scale=1';

  function lock(e: Event) {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      viewport!.content = locked;
    }
  }
  function unlock(e: Event) {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      viewport!.content = original;
    }
  }

  document.addEventListener('focus', lock, true);
  document.addEventListener('blur', unlock, true);
})();

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');
