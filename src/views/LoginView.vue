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

function onGoogleError(message: string) {
  if (!authStore.error) {
    authStore.error = message;
  }
}

onMounted(() => {
  authStore.loadPublicConfig();
});
</script>

<template>
  <section class="auth-view">
    <div class="auth-layout">
      <div class="brand-area">
        <div class="brand-mark-wrap" aria-hidden="true">
          <div class="brand-mark-glow" />
          <div class="brand-mark-orbit" />
          <svg class="brand-mark" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line class="brand-link link-a" x1="80" y1="80" x2="42" y2="42" />
            <line class="brand-link link-b" x1="80" y1="80" x2="118" y2="42" />
            <line class="brand-link link-c" x1="80" y1="80" x2="118" y2="118" />
            <line class="brand-link link-d" x1="80" y1="80" x2="42" y2="118" />
            <circle class="brand-node node-a" cx="42" cy="42" r="11" />
            <circle class="brand-node node-b" cx="118" cy="42" r="11" />
            <circle class="brand-node node-c" cx="118" cy="118" r="11" />
            <circle class="brand-node node-d" cx="42" cy="118" r="11" />
            <circle class="brand-core" cx="80" cy="80" r="20" />
          </svg>
        </div>

        <div class="brand-copy">
          <h1 class="brand-title">
            <span class="line-break">Погрузитесь в ваши связи,</span>
            <span class="line-break">чтобы раскрыть их потенциал</span>
            <span class="line-break">на 1000%</span>
          </h1>
          <p class="brand-description">
            <span class="line-break line-nowrap-desktop">
              Ищите скрытые возможности в
              <span class="desc-chip">контактах</span>,
              <span class="desc-chip">компаниях</span>
              и
              <span class="desc-chip">событиях</span>
            </span>
            <span class="line-break">Ставьте цели, привлекайте ресурсы и добивайтесь результатов</span>
          </p>
        </div>
      </div>

      <div class="auth-actions">
        <p class="auth-actions-title">Регистрация и вход</p>
        <div class="signin-button-slot">
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
        <p v-if="authStore.loading" class="signin-state">Проверка аккаунта...</p>
        <p v-if="authStore.error" class="signin-error">{{ authStore.error }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.auth-view {
  height: 100%;
  min-height: 100dvh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(20px, 4vw, 40px);
  background: #ffffff;
  overflow-y: auto;
}

.auth-layout {
  width: min(980px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: clamp(96px, 14vh, 180px);
}

.brand-area {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: clamp(52px, 8vh, 96px);
}

.brand-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}

.brand-mark-wrap {
  width: 176px;
  height: 176px;
  border-radius: 50%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-mark-glow {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(16, 88, 255, 0.27) 0%, rgba(16, 88, 255, 0.05) 55%, transparent 72%);
  animation: brandPulse 2.9s ease-in-out infinite;
}

.brand-mark-orbit {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px dashed rgba(16, 88, 255, 0.35);
  animation: orbitSpin 11s linear infinite;
}

.brand-mark {
  width: 160px;
  height: 160px;
  position: relative;
  z-index: 1;
}

.brand-link {
  stroke: #1058ff;
  stroke-opacity: 0.85;
  stroke-width: 5.5;
  stroke-linecap: round;
  stroke-dasharray: 7 9;
  animation: linkFlow 2.4s linear infinite;
}

.brand-link.link-b {
  animation-delay: 0.2s;
}

.brand-link.link-c {
  animation-delay: 0.4s;
}

.brand-link.link-d {
  animation-delay: 0.6s;
}

.brand-node {
  fill: #ffffff;
  stroke: #1058ff;
  stroke-width: 4;
  animation: nodeBeat 2.2s ease-in-out infinite;
}

.brand-node.node-b {
  animation-delay: 0.2s;
}

.brand-node.node-c {
  animation-delay: 0.4s;
}

.brand-node.node-d {
  animation-delay: 0.6s;
}

.brand-core {
  fill: #1058ff;
  stroke: #ffffff;
  stroke-width: 5;
  animation: coreBreathe 2.4s ease-in-out infinite;
}

.brand-title {
  margin: 0;
  max-width: 24ch;
  font-size: clamp(28px, 4.4vw, 42px);
  line-height: 1.14;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #0f172a;
}

.brand-description {
  margin: 0 auto;
  max-width: 80ch;
  color: #334155;
  font-size: clamp(14px, 1.6vw, 18px);
  line-height: 1.52;
  text-align: center;
}

.desc-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid #cde0ff;
  background: #eff6ff;
  color: #1f3f86;
  padding: 2px 10px;
  margin: 0 2px;
  font-size: 0.94em;
  font-weight: 700;
  line-height: 1.3;
  vertical-align: baseline;
  white-space: nowrap;
}

.line-break {
  display: block;
}

.line-nowrap-desktop {
  white-space: nowrap;
}

.auth-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 32px;
  margin-top: clamp(40px, 8vh, 96px);
}

.auth-actions-title {
  margin: 0;
  font-size: 15px;
  line-height: 1.2;
  font-weight: 700;
  color: #1e3a8a;
}

.signin-button-slot {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.signin-state {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.signin-error {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
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

@keyframes orbitSpin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes brandPulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.96);
  }
  50% {
    opacity: 0.9;
    transform: scale(1.04);
  }
}

@keyframes coreBreathe {
  0%,
  100% {
    transform: scale(0.95);
  }
  50% {
    transform: scale(1.07);
  }
}

@keyframes nodeBeat {
  0%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.1);
  }
}

@keyframes linkFlow {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -32;
  }
}

@media (max-width: 560px) {
  .auth-layout {
    gap: 28px;
  }

  .brand-area {
    gap: 18px;
  }

  .brand-copy,
  .auth-actions {
    gap: 12px;
  }

  .auth-actions {
    margin-top: 6px;
  }

  .brand-mark-wrap {
    width: 108px;
    height: 108px;
  }

  .brand-mark {
    width: 96px;
    height: 96px;
  }

  .brand-title {
    font-size: 24px;
    line-height: 1.16;
  }

  .auth-actions-title {
    font-size: 14px;
  }

  .brand-description {
    font-size: 13px;
    line-height: 1.4;
  }
}

@media (max-width: 980px) {
  .line-nowrap-desktop {
    white-space: normal;
  }
}

@media (max-width: 768px) {
  .auth-view {
    align-items: flex-start;
    padding: 14px 12px 18px;
  }

  .auth-layout {
    width: min(100%, 520px);
    justify-content: flex-start;
    gap: 34px;
  }

  .brand-area {
    gap: 24px;
  }

  .brand-copy {
    gap: 16px;
  }

  .auth-actions {
    gap: 16px;
    margin-top: 8px;
  }
}
</style>
