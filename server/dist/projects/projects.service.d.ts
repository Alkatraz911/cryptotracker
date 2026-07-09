import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
export declare class ProjectsService {
    private readonly repo;
    constructor(repo: Repository<Project>);
    list(userId: string): Promise<{
        id: string;
        name: string;
        updatedAt: Date;
        counts: {
            Wallet: number;
            User: number;
            IP: number;
            Tx: number;
        };
    }[]>;
    create(userId: string, dto: CreateProjectDto): Promise<Project>;
    findOwned(id: string, userId: string): Promise<Project>;
    update(id: string, userId: string, dto: UpdateProjectDto): Promise<Project>;
    remove(id: string, userId: string): Promise<void>;
}
