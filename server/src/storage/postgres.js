// Postgres storage (used when DATABASE_URL is set). graph is stored as jsonb.
import pg from "pg";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  graph      jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);
`;

const userRow = (r) =>
  r ? { id: r.id, email: r.email, passwordHash: r.password_hash, createdAt: r.created_at } : null;

const projectRow = (r) =>
  r
    ? {
        id: r.id, userId: r.user_id, name: r.name, graph: r.graph,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }
    : null;

export class PostgresStorage {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString });
  }
  async init() {
    await this.pool.query(SCHEMA);
    return this;
  }
  kind() { return "postgres"; }

  async getUserByEmail(email) {
    const r = await this.pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return userRow(r.rows[0]);
  }
  async getUserById(id) {
    const r = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return userRow(r.rows[0]);
  }
  async createUser(u) {
    await this.pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1,$2,$3,$4)",
      [u.id, u.email, u.passwordHash, u.createdAt]
    );
    return u;
  }
  async listProjects(userId) {
    const r = await this.pool.query("SELECT * FROM projects WHERE user_id = $1", [userId]);
    return r.rows.map(projectRow);
  }
  async getProject(id) {
    const r = await this.pool.query("SELECT * FROM projects WHERE id = $1", [id]);
    return projectRow(r.rows[0]);
  }
  async createProject(p) {
    await this.pool.query(
      `INSERT INTO projects (id, user_id, name, graph, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
      [p.id, p.userId, p.name, JSON.stringify(p.graph), p.createdAt, p.updatedAt]
    );
    return p;
  }
  async updateProject(id, patch) {
    const r = await this.pool.query(
      `UPDATE projects SET
         name       = COALESCE($2, name),
         graph      = COALESCE($3::jsonb, graph),
         updated_at = $4
       WHERE id = $1 RETURNING *`,
      [id, patch.name ?? null, patch.graph != null ? JSON.stringify(patch.graph) : null, patch.updatedAt]
    );
    return projectRow(r.rows[0]);
  }
  async deleteProject(id) {
    await this.pool.query("DELETE FROM projects WHERE id = $1", [id]);
  }
}
