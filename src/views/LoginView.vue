<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GoogleSignInButton from '../components/auth/GoogleSignInButton.vue';
import { useAuthStore } from '../stores/auth';
import { useEntitiesStore } from '../stores/entities';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const entitiesStore = useEntitiesStore();

const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

const redirectTarget = computed(() => {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    return redirect;
  }
  return '/projects';
});

async function onGoogleCredential(credential: string) {
  try {
    await authStore.signInWithGoogleCredential(credential);
    await entitiesStore.bootstrap();
    await router.replace(redirectTarget.value);
  } catch {
    // authStore.error already populated
  }
}

function onGoogleError(message: string) {
  if (!authStore.error) {
    authStore.error = message;
  }
}
</script>

<template>
  <section class="auth-view">
    <div class="auth-card">
      <h1 class="auth-title">Synapse12</h1>
      <p class="auth-subtitle">
        Войдите через Google, чтобы открыть проекты и сущности.
      </p>

      <GoogleSignInButton
        :client-id="googleClientId"
        :disabled="authStore.loading"
        @credential="onGoogleCredential"
        @error="onGoogleError"
      />

      <p v-if="authStore.error" class="auth-error">{{ authStore.error }}</p>
    </div>
  </section>
</template>

<style scoped>
.auth-view {
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.auth-card {
  width: min(420px, 100%);
  border-radius: 18px;
  border: 1px solid #dbe4f3;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 16px 32px rgba(112, 144, 176, 0.2);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.auth-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
  font-weight: 800;
  color: #0f172a;
}

.auth-subtitle {
  margin: 0;
  text-align: center;
  color: #64748b;
  font-size: 14px;
  line-height: 1.45;
  max-width: 320px;
}

.auth-error {
  margin: 2px 0 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  line-height: 1.35;
}
</style>
