import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/Login.page';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProjectPage } from './pages/ProjectPage';
import { CreateProjectPage } from './pages/CreateProjectPage';
import { EditProjectPage } from './pages/EditProjectPage';
import { EditTaskPage } from './pages/EditTaskPage';

export function App() {
  return (
    <Routes>
      {/* 1. RUTA PÚBLICA: Login independiente en pantalla completa */}
      <Route path="/login" element={<LoginPage />} />

      {/* 2. Redirección automática al Login al abrir la app */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* 3. RUTAS PRIVADAS (Requieren Backend + Docker corriendo) */}
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="projects/new" element={<CreateProjectPage />} />
        <Route path="projects/:projectId/edit" element={<EditProjectPage />} />
        <Route path="tasks/:taskId/edit" element={<EditTaskPage />} />
        <Route path="projects/:projectId/*" element={<ProjectPage />} />
        <Route path="users" element={<PlaceholderPage title="Permisos y usuarios" />} />
        <Route path="notifications" element={<PlaceholderPage title="Notificaciones" />} />
        <Route path="*" element={<PlaceholderPage title="Página no encontrada" />} />
        <Route path="/home" element={<HomePage />} />
      </Route>

      {/* 4. Cualquier otra ruta redirige al Login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;