import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './Login.page';

function render(url = '/login') {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const input = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';

describe('LoginPage', () => {
  it('tiene el campo Email (type=email) con su label', () => {
    const html = render();
    expect(input(html, 'login-email')).toContain('type="email"');
    expect(html).toMatch(/<label[^>]*for="login-email"[^>]*>Email<\/label>/);
  });

  it('tiene el campo Contraseña y NUNCA aparece como texto por defecto (type=password)', () => {
    const html = render();
    expect(input(html, 'login-password')).toContain('type="password"');
    expect(input(html, 'login-password')).not.toContain('type="text"');
    expect(input(html, 'login-password')).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/<label[^>]*for="login-password"[^>]*>Contraseña<\/label>/);
  });

  it('tiene el botón "Iniciar sesión" (submit) y el botón Mostrar para la contraseña', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Iniciar sesión<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Mostrar<\/button>/);
  });

  it('mantiene el botón "Continuar con Google" y el separador "o" entre ambos métodos', () => {
    const html = render();
    expect(html).toContain('Continuar con Google');
    const order = [html.indexOf('Iniciar sesión</button>'), html.indexOf('>o<'), html.indexOf('Continuar con Google')];
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('sin ?error=: no muestra ningún mensaje de error', () => {
    expect(render()).not.toContain('role="alert"');
  });

  it('?error=USER_NOT_REGISTERED (Google con un email que no existe): explica que la cuenta no está registrada', () => {
    const html = render('/login?error=USER_NOT_REGISTERED');
    expect(html).toContain('role="alert"');
    expect(html).toContain('no está registrada');
  });

  it('?error=USER_DISABLED: muestra el aviso de usuario deshabilitado', () => {
    expect(render('/login?error=USER_DISABLED')).toContain('deshabilitado');
  });

  it('el formulario arranca sin credenciales y sin mensaje de credenciales incorrectas', () => {
    const html = render();
    expect(input(html, 'login-email')).toContain('value=""');
    expect(input(html, 'login-password')).toContain('value=""');
    expect(html).not.toContain('Email o contraseña incorrectos');
  });
});

describe('seguridad del formulario de login (revisión estática del código)', () => {
  const sources = ['../components/login/EmailPasswordForm.tsx', '../lib/loginForm.ts', './Login.page.tsx'].map((path) =>
    readFileSync(new URL(path, import.meta.url), 'utf8'),
  );

  it('la contraseña no se guarda en localStorage/sessionStorage ni en cookies del navegador', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });

  it('nada del flujo de login hace console.log (no se loguea la contraseña)', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/console\.(log|debug|info|warn|error)/);
    }
  });
});
