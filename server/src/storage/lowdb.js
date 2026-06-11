// Fallback storage: JSON file (used when DATABASE_URL is not set).
import { JSONFilePreset } from "lowdb/node";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "..", "data.json");

export class LowdbStorage {
  async init() {
    this.db = await JSONFilePreset(DATA_FILE, { users: [], projects: [] });
    return this;
  }
  kind() { return "lowdb (JSON file) — set DATABASE_URL to use Postgres"; }

  async getUserByEmail(email) {
    return this.db.data.users.find((u) => u.email === email) ?? null;
  }
  async getUserById(id) {
    return this.db.data.users.find((u) => u.id === id) ?? null;
  }
  async createUser(u) {
    this.db.data.users.push(u);
    await this.db.write();
    return u;
  }
  async listProjects(userId) {
    return this.db.data.projects.filter((p) => p.userId === userId);
  }
  async getProject(id) {
    return this.db.data.projects.find((p) => p.id === id) ?? null;
  }
  async createProject(p) {
    this.db.data.projects.push(p);
    await this.db.write();
    return p;
  }
  async updateProject(id, patch) {
    const p = this.db.data.projects.find((x) => x.id === id);
    if (!p) return null;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) p[k] = v;
    await this.db.write();
    return p;
  }
  async deleteProject(id) {
    this.db.data.projects = this.db.data.projects.filter((x) => x.id !== id);
    await this.db.write();
  }
}
