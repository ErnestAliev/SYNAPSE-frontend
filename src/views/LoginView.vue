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
    await router.replace(redirectTarget.value);
    if (!entitiesStore.initialized) {
      void entitiesStore.bootstrap();
    } else {
      void entitiesStore.fetchEntities({ silent: true });
    }
  } catch {
    // authStore.error already populated
  }
}

function onGoogleError() {}

onMounted(() => {
  authStore.loadPublicConfig();
});
</script>

<template>
  <section class="auth-view">
    <div class="auth-card">
      <h1 class="auth-title">Добро пожаловать в Synapse12</h1>

      <GoogleSignInButton
        v-if="isGoogleButtonReady"
        :client-id="authStore.googleClientId"
        :disabled="authStore.loading"
        @credential="onGoogleCredential"
        @error="onGoogleError"
      />
      <button v-else type="button" class="auth-google-loading" disabled>
        Войти через Google
      </button>
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
  width: min(380px, 100%);
  border-radius: 18px;
  border: 1px solid #dbe4f3;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 16px 32px rgba(112, 144, 176, 0.2);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.auth-title {
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
  font-weight: 800;
  color: #0f172a;
  text-align: center;
}

.auth-google-loading {
  height: 36px;
  min-width: 210px;
  border-radius: 999px;
  border: 1px solid #dbe4f3;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  padding: 0 14px;
  cursor: not-allowed;
}
</style>
