import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Project } from './entities/project.entity';

const mockRepo = { findBy: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() };

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  it('lists projects sorted by updatedAt desc', async () => {
    mockRepo.findBy.mockResolvedValue([
      { id: '1', name: 'A', updatedAt: new Date('2024-01-01'), graph: { nodes: [], edges: [] } },
      { id: '2', name: 'B', updatedAt: new Date('2024-06-01'), graph: { nodes: [], edges: [] } },
    ]);
    const result = await service.list('user1');
    expect(result[0].name).toBe('B');
  });

  it('throws NotFoundException for non-owned project', async () => {
    mockRepo.findOneBy.mockResolvedValue({ id: '1', userId: 'other' });
    await expect(service.findOwned('1', 'user1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for missing project', async () => {
    mockRepo.findOneBy.mockResolvedValue(null);
    await expect(service.findOwned('missing', 'user1')).rejects.toThrow(NotFoundException);
  });
});
