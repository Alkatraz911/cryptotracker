"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const typeorm_1 = require("@nestjs/typeorm");
const common_1 = require("@nestjs/common");
const projects_service_1 = require("./projects.service");
const project_entity_1 = require("./entities/project.entity");
const mockRepo = { findBy: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() };
describe('ProjectsService', () => {
    let service;
    beforeEach(async () => {
        jest.clearAllMocks();
        const module = await testing_1.Test.createTestingModule({
            providers: [
                projects_service_1.ProjectsService,
                { provide: (0, typeorm_1.getRepositoryToken)(project_entity_1.Project), useValue: mockRepo },
            ],
        }).compile();
        service = module.get(projects_service_1.ProjectsService);
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
        await expect(service.findOwned('1', 'user1')).rejects.toThrow(common_1.NotFoundException);
    });
    it('throws NotFoundException for missing project', async () => {
        mockRepo.findOneBy.mockResolvedValue(null);
        await expect(service.findOwned('missing', 'user1')).rejects.toThrow(common_1.NotFoundException);
    });
});
//# sourceMappingURL=projects.service.spec.js.map