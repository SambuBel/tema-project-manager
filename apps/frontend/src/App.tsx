import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProjectPage } from './pages/ProjectPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="projects/:projectId/*" element={<ProjectPage />} />
        <Route path="users" element={<PlaceholderPage title="Permisos y usuarios" />} />
        <Route path="notifications" element={<PlaceholderPage title="Notificaciones" />} />
        <Route path="*" element={<PlaceholderPage title="Página no encontrada" />} />
      </Route>
    </Routes>
  );
}
