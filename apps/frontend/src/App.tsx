import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/Login.page';
import { RequireAuth } from './components/auth/RequireAuth';
import { RedirectIfAuthenticated } from './components/auth/RedirectIfAuthenticated';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProjectPage } from './pages/ProjectPage';
import { CreateProjectPage } from './pages/CreateProjectPage';
import { EditProjectPage } from './pages/EditProjectPage';
import { EditTaskPage } from './pages/EditTaskPage';
import { RolesMatrixPage } from './pages/RolesMatrixPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { RequireRole } from './components/auth/RequireRole';
import { canViewUsersUI } from './lib/permissions';

export function App() {
  return (
    <Routes>
      {/* Pública: si ya hay sesión, RedirectIfAuthenticated manda a "/" en vez de mostrarla. */}
      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Privadas: sin sesión, RequireAuth manda a /login (arranque de la app incluido). */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="projects/new" element={<CreateProjectPage />} />
          <Route path="projects/:projectId/edit" element={<EditProjectPage />} />
          <Route path="tasks/:taskId/edit" element={<EditTaskPage />} />
          <Route path="projects/:projectId/*" element={<ProjectPage />} />
          <Route path="roles" element={<RolesMatrixPage />} />
          {/* "No alcanza con ocultar el link": la ruta queda protegida acá, no solo en el Sidebar. */}
          <Route element={<RequireRole allow={canViewUsersUI} />}>
            <Route path="users" element={<AdminUsersPage />} />
          </Route>
          <Route path="notifications" element={<PlaceholderPage title="Notificaciones" />} />
          <Route path="*" element={<PlaceholderPage title="Página no encontrada" />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
