import { Project } from '../../projects/entities/project.entity';
export declare class User {
    id: string;
    email: string;
    passwordHash: string;
    role: string;
    createdAt: Date;
    projects: Project[];
}
