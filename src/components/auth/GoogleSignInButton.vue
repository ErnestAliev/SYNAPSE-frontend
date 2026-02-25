<script setup lang="ts">
import { onMounted, ref } from 'vue';

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleButtonConfiguration = {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  width?: number | string;
  logo_alignment?: 'left' | 'center';
  locale?: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (element: HTMLElement, options: GoogleButtonConfiguration) => void;
        };
      };
    };
  }
}

const props = defineProps<{
  clientId: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'credential', credential: string): void;
  (event: 'error', message: string): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);

function onGoogleCredentialResponse(response: GoogleCredentialResponse) {
  const credential = typeof response.credential === 'string' ? response.credential.trim() : '';
  if (!credential) {
    emit('error', 'Google credential is empty');
    return;
  }

  emit('credential', credential);
}

function renderGoogleButton() {
  if (!containerRef.value) return;
  if (!window.google?.accounts?.id) return;
  if (!props.clientId.trim()) return;

  containerRef.value.innerHTML = '';

  window.google.accounts.id.initialize({
    client_id: props.clientId.trim(),
    callback: onGoogleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  window.google.accounts.id.renderButton(containerRef.value, {
    theme: 'outline',
    size: 'medium',
    shape: 'pill',
    text: 'signin_with',
    width: 210,
    logo_alignment: 'left',
    locale: 'ru',
  });
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google script')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load Google script')), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

onMounted(async () => {
  if (props.disabled) return;

  if (!props.clientId.trim()) {
    emit('error', 'VITE_GOOGLE_CLIENT_ID is not configured');
    return;
  }

  try {
    await loadGoogleIdentityScript();
    renderGoogleButton();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize Google Sign-In';
    emit('error', message);
  }
});
</script>

<template>
  <div class="google-sign-in-btn">
    <div v-if="!disabled && clientId.trim()" ref="containerRef" class="google-btn-slot" />
    <button v-else type="button" class="google-btn-fallback" disabled>
      Вход через Google
    </button>
  </div>
</template>

<style scoped>
.google-sign-in-btn {
  display: inline-flex;
  align-items: center;
}

.google-btn-slot {
  min-width: 210px;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.google-btn-fallback {
  height: 36px;
  min-width: 190px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  padding: 0 12px;
  cursor: not-allowed;
}
</style>
