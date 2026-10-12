import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMutationOptions } from './mutationLogic';
import type { Task, TaskStatus } from '@tema/shared-types';

describe('mutationLogic', () => {
  let qcMock: any;
  let apiUpdateTaskStatusMock: any;
  let setToastMock: any;

  beforeEach(() => {
    qcMock = {
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    };
    apiUpdateTaskStatusMock = vi.fn();
    setToastMock = vi.fn();
  });

  it('debe realizar la mutación llamando a la API', async () => {
    const options = getMutationOptions(qcMock, 'proj1', apiUpdateTaskStatusMock, setToastMock);
    apiUpdateTaskStatusMock.mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' });

    await options.mutationFn({ taskId: 't1', status: 'IN_PROGRESS' });
    expect(apiUpdateTaskStatusMock).toHaveBeenCalledWith('t1', 'IN_PROGRESS');
  });

  it('debe hacer un update optimista en onMutate', async () => {
    const options = getMutationOptions(qcMock, 'proj1', apiUpdateTaskStatusMock, setToastMock);
    const mockTasks = [{ id: 't1', status: 'PENDING' }];
    qcMock.getQueryData.mockReturnValue(mockTasks);

    const context = await options.onMutate({ taskId: 't1', status: 'IN_PROGRESS' });
    
    expect(qcMock.cancelQueries).toHaveBeenCalledWith({ queryKey: ['tasks', 'proj1'] });
    expect(context.previousTasks).toBe(mockTasks);
    expect(qcMock.setQueryData).toHaveBeenCalled();
    
    // Test the updater function passed to setQueryData
    const updater = qcMock.setQueryData.mock.calls[0][1];
    const newTasks = updater(mockTasks);
    expect(newTasks).toEqual([{ id: 't1', status: 'IN_PROGRESS' }]);
  });

  it('debe hacer rollback y mostrar error si la API falla', () => {
    const options = getMutationOptions(qcMock, 'proj1', apiUpdateTaskStatusMock, setToastMock);
    const mockPreviousTasks = [{ id: 't1', status: 'PENDING' }];
    
    options.onError(new Error('Network error'), { taskId: 't1', status: 'IN_PROGRESS' }, { previousTasks: mockPreviousTasks });
    
    expect(qcMock.setQueryData).toHaveBeenCalledWith(['tasks', 'proj1'], mockPreviousTasks);
    expect(setToastMock).toHaveBeenCalledWith('Error al mover la tarea: Network error');
  });

  it('debe hacer rollback y mostrar mensaje explicativo si falta permisos (RF-TB-05)', () => {
    const options = getMutationOptions(qcMock, 'proj1', apiUpdateTaskStatusMock, setToastMock);
    const mockPreviousTasks = [{ id: 't1', status: 'PENDING' }];
    const permissionError = Object.assign(new Error('403 Forbidden'), {
      details: ['No podés cambiar el estado de esta tarea.'],
    });

    options.onError(permissionError, { taskId: 't1', status: 'IN_PROGRESS' }, { previousTasks: mockPreviousTasks });

    expect(qcMock.setQueryData).toHaveBeenCalledWith(['tasks', 'proj1'], mockPreviousTasks);
    expect(setToastMock).toHaveBeenCalledWith(
      'Error al mover la tarea: No podés cambiar el estado de esta tarea.'
    );
  });

  it('debe hacer rollback y mostrar mensaje explicativo si se viola RN-04', () => {
    const options = getMutationOptions(qcMock, 'proj1', apiUpdateTaskStatusMock, setToastMock);
    const mockPreviousTasks = [{ id: 't1', status: 'IN_PROGRESS' }];
    const businessRuleError = Object.assign(new Error('400 Bad Request'), {
      details: ['No se puede completar una tarea con subtareas pendientes'],
    });

    options.onError(businessRuleError, { taskId: 't1', status: 'COMPLETED' }, { previousTasks: mockPreviousTasks });

    expect(qcMock.setQueryData).toHaveBeenCalledWith(['tasks', 'proj1'], mockPreviousTasks);
    expect(setToastMock).toHaveBeenCalledWith(
      'Error al mover la tarea: No se puede completar una tarea con subtareas pendientes'
    );
  });

  it('debe invalidar las queries en onSettled', () => {
    const options = getMutationOptions(qcMock, 'proj1', apiUpdateTaskStatusMock, setToastMock);
    
    options.onSettled();
    
    expect(qcMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks', 'proj1'] });
  });
});
