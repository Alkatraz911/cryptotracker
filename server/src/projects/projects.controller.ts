import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Request, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

interface AuthRequest { user: JwtPayload }

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Request() req: AuthRequest) {
    return this.projects.list(req.user.uid);
  }

  @Post()
  create(@Request() req: AuthRequest, @Body() dto: CreateProjectDto) {
    return this.projects.create(req.user.uid, dto).then((p) => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt,
    }));
  }

  @Get(':id')
  findOne(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.projects.findOwned(id, req.user.uid);
  }

  @Put(':id')
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, req.user.uid, dto).then((p) => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt,
    }));
  }

  @Delete(':id')
  async remove(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.projects.remove(id, req.user.uid);
    return { ok: true };
  }
}
