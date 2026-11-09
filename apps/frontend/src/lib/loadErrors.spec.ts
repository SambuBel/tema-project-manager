import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { projectLoadErrorMessage, taskLoadErrorMessage } from './loadErrors';

const apiError = (status: number) => new ApiRequestError(status, 'x');

describe('projectLoadErrorMessage', () => {
  it('404 → no existe; 403 → sin acceso', () => {
    expect(projectLoadErrorMessage(apiError(404))).toBe('El proyecto no existe o fue eliminado.');
    expect(projectLoadErrorMessage(apiError(403))).toBe('No tenés acceso a este proyecto.');
  });

  it('cualquier otro error → mensaje genérico (o el que se pase)', () => {
    expect(projectLoadErrorMessage(apiError(500))).toBe('Error al cargar el proyecto.');
    expect(projectLoadErrorMessage(new TypeError('Failed to fetch'))).toBe('Error al cargar el proyecto.');
    expect(projectLoadErrorMessage(apiError(500), 'Otro texto')).toBe('Otro texto');
  });
});

describe('taskLoadErrorMessage', () => {
  it('404 y 400 (id inválido) → no existe; 403 → sin acceso', () => {
    expect(taskLoadErrorMessage(apiError(404))).toBe('La tarea no existe o fue eliminada.');
    expect(taskLoadErrorMessage(apiError(400))).toBe('La tarea no existe o fue eliminada.');
    expect(taskLoadErrorMessage(apiError(403))).toBe('No tenés acceso a esta tarea.');
  });

  it('cualquier otro error → mensaje genérico (o el que se pase)', () => {
    expect(taskLoadErrorMessage(apiError(500))).toBe('Error al cargar la tarea.');
    expect(taskLoadErrorMessage(apiError(500), 'Error al cargar la tarea para edición.')).toBe('Error al cargar la tarea para edición.');
  });
});
