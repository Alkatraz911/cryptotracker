import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
interface AuthRequest {
    user: JwtPayload;
}
export declare class ProjectsController {
    private readonly projects;
    constructor(projects: ProjectsService);
    list(req: AuthRequest): Promise<{
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
    create(req: AuthRequest, dto: CreateProjectDto): Promise<{
        id: string;
        name: string;
        updatedAt: Date;
    }>;
    findOne(req: AuthRequest, id: string): Promise<import("./entities/project.entity").Project>;
    update(req: AuthRequest, id: string, dto: UpdateProjectDto): Promise<{
        id: string;
        name: string;
        updatedAt: Date;
    }>;
    remove(req: AuthRequest, id: string): Promise<{
        ok: boolean;
    }>;
}
export {};
