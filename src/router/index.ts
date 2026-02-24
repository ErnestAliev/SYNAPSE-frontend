import { createRouter, createWebHistory } from 'vue-router';
import CollectionView from '../views/CollectionView.vue';
import ProjectCanvasView from '../views/ProjectCanvasView.vue';

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
      path: '/projects/:id/canvas',
      name: 'project-canvas',
      component: ProjectCanvasView,
      props: true,
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
