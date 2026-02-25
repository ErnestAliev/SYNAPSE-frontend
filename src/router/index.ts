import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import CollectionView from '../views/CollectionView.vue';
import CanvasView from '../views/CanvasView.vue';
import LoginView from '../views/LoginView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/auth',
    },
    {
      path: '/auth',
      name: 'auth-login',
      component: LoginView,
      meta: {
        public: true,
      },
    },
    {
      path: '/projects',
      name: 'projects',
      component: CollectionView,
      props: {
        type: 'project',
      },
    },
    {
      path: '/canvas/:id',
      name: 'project-canvas',
      component: CanvasView,
      props: true,
    },
    {
      path: '/projects/:id/canvas',
      redirect: (to) => `/canvas/${to.params.id}`,
    },
    {
      path: '/entities/:type',
      name: 'entities-by-type',
      component: CollectionView,
      props: (route) => ({
        type: route.params.type,
      }),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/auth',
    },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  if (!authStore.initialized) {
    await authStore.bootstrap();
  }

  const isPublicRoute = Boolean(to.meta.public);
  if (!authStore.isAuthenticated && !isPublicRoute) {
    return {
      name: 'auth-login',
      query: {
        redirect: to.fullPath,
      },
    };
  }

  if (authStore.isAuthenticated && to.name === 'auth-login') {
    const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/projects';
    return redirect;
  }

  return true;
});

export default router;
