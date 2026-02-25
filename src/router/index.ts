import { createRouter, createWebHistory } from 'vue-router';
import CollectionView from '../views/CollectionView.vue';
import CanvasView from '../views/CanvasView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/projects',
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
      redirect: '/projects',
    },
  ],
});

export default router;
