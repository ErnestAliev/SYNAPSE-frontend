<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GoogleSignInButton from '../components/auth/GoogleSignInButton.vue';
import { useAuthStore } from '../stores/auth';
import { useEntitiesStore } from '../stores/entities';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const entitiesStore = useEntitiesStore();

const showDevLogin = import.meta.env.DEV;
const isGoogleButtonReady = computed(
  () => Boolean(authStore.googleClientId) || authStore.publicConfigLoaded,
);

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

async function onDevLogin() {
  try {
    await authStore.signInAsDev();
    await entitiesStore.bootstrap();
    await router.replace(redirectTarget.value);
  } catch {
    // authStore.error already populated
  }
}

onMounted(() => {
  authStore.loadPublicConfig();
});
</script>

<template>
  <section class="auth-view">
    <div class="auth-card">
      <h1 class="auth-title">Добро пожаловать в Synapse12</h1>
      <p class="auth-subtitle">
        Пройдите регистрацию через Google. После выбора аккаунта система создаст ваш профиль и
        персональное рабочее пространство.
      </p>
      <div class="auth-note">Все проекты, настройки и сущности будут привязаны к вашему аккаунту.</div>

      <GoogleSignInButton
        v-if="isGoogleButtonReady"
        :client-id="authStore.googleClientId"
        :disabled="authStore.loading"
        @credential="onGoogleCredential"
        @error="onGoogleError"
      />
      <button v-else type="button" class="auth-google-loading" disabled>
        Загрузка входа...
      </button>

      <button
        v-if="showDevLogin"
        type="button"
        class="auth-dev-btn"
        :disabled="authStore.loading"
        @click="onDevLogin"
      >
        Войти локально (dev)
      </button>

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

.auth-note {
  width: 100%;
  border-radius: 12px;
  border: 1px solid #dbe4f3;
  background: #f8fbff;
  color: #475569;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  padding: 10px 12px;
}

.auth-error {
  margin: 2px 0 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  line-height: 1.35;
}

.auth-dev-btn {
  height: 36px;
  min-width: 210px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 0 14px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.auth-dev-btn:hover:not(:disabled) {
  border-color: #bfd5ff;
  background: #eef4ff;
  color: #1058ff;
}

.auth-dev-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.auth-google-loading {
  height: 36px;
  min-width: 210px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  padding: 0 14px;
  cursor: not-allowed;
}
</style>
