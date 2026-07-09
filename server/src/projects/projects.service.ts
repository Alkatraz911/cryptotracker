import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Project } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

interface GraphLike { nodes?: Array<{ kind?: string }>; edges?: unknown[] }

function counts(graph: GraphLike | null | undefined) {
  const c = { Wallet: 0, User: 0, IP: 0, Tx: 0 };
  for (const n of graph?.nodes ?? []) {
    const k = n.kind as keyof typeof c;
    if (k in c) c[k]++;
  }
  return c;
}

@Injectable()
export class ProjectsService {
  constructor(@InjectRepository(Project) private readonly repo: Repository<Project>) {}

  async list(userId: string) {
    const projects = await this.repo.findBy({ userId });
    return projects
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, counts: counts(p.graph as GraphLike) }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    const project = this.repo.create({
      id: uuidv4(),
      userId,
      name: dto.name,
      graph: dto.graph ?? { nodes: [], edges: [] },
    });
    return this.repo.save(project);
  }

  async findOwned(id: string, userId: string): Promise<Project> {
    const p = await this.repo.findOneBy({ id });
    if (!p || p.userId !== userId) throw new NotFoundException('not found');
    return p;
  }

  async update(id: string, userId: string, dto: UpdateProjectDto): Promise<Project> {
    const p = await this.findOwned(id, userId);
    if (dto.name !== undefined) p.name = dto.name;
    if (dto.graph !== undefined) p.graph = dto.graph;
    return this.repo.save(p);
  }

  async remove(id: string, userId: string): Promise<void> {
    const p = await this.findOwned(id, userId);
    await this.repo.remove(p);
  }
}
