import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardCard } from './BoardCard';
import { canEditTaskUI } from '../../lib/permissions';
import * as useCurrentUserModule from '../../hooks/useCurrentUser';
import * as useMyMembershipModule from '../../hooks/useMyMembership';
import * as reactQueryModule from '@tanstack/react-query';

// Mock dependencies
vi.mock('../../lib/permissions', () => ({
  canEditTaskUI: vi.fn(),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('../../hooks/useMyMembership', () => ({
  useMyMembership: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

describe('BoardCard Permissions', () => {
  const mockTask = {
    id: 't1',
    projectId: 'p1',
    title: 'Test',
    status: 'PENDING' as any,
    priority: 'LOW' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useCurrentUserModule.useCurrentUser as any).mockReturnValue({ user: { id: 'u1' } });
    (useMyMembershipModule.useMyMembership as any).mockReturnValue({ membership: { role: 'MEMBER' } });
    (reactQueryModule.useQuery as any).mockReturnValue({ data: { id: 'p1' } });
  });

  it('debe deshabilitar el arrastre si canEditTaskUI es false', () => {
    (canEditTaskUI as any).mockReturnValue(false);
    
    // Test the component as a pure function
    const element = BoardCard({ task: mockTask as any, index: 0, onSelectTask: vi.fn() }) as any;
    
    expect(canEditTaskUI).toHaveBeenCalled();
    // Draggable is the root element returned
    expect(element.props.isDragDisabled).toBe(true);
  });

  it('debe permitir el arrastre si canEditTaskUI es true', () => {
    (canEditTaskUI as any).mockReturnValue(true);
    
    const element = BoardCard({ task: mockTask as any, index: 0, onSelectTask: vi.fn() }) as any;
    
    expect(element.props.isDragDisabled).toBe(false);
  });
});

