import { MigrationInterface, QueryRunner } from 'typeorm';

// Bootstrap table for the AI RAG knowledge store, replacing the local JSON
// file (server/src/ai/knowledge.service.ts) which doesn't survive Vercel's
// per-invocation filesystem. Seed rows mirror the SEED array that previously
// lived in the service (same content, same weights) so behavior is unchanged.
export class AddKnowledgeEntries1719900000000 implements MigrationInterface {
  name = 'AddKnowledgeEntries1719900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_entries" (
        "id" varchar NOT NULL,
        "kind" varchar NOT NULL,
        "network" varchar,
        "address" varchar,
        "title" varchar NOT NULL,
        "content" text NOT NULL,
        "weight" integer NOT NULL DEFAULT 1,
        "source" varchar,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_entries" PRIMARY KEY ("id")
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_knowledge_kind" ON "knowledge_entries" ("kind")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_knowledge_address" ON "knowledge_entries" ("address")`);

    const seed: Array<[string, string, string, number]> = [
      [
        'seed-peel-chain',
        'Peel chain (последовательное "отщипывание")',
        'Средства проходят через длинную цепочку кошельков, на каждом шаге небольшая сумма отделяется ' +
          'на биржу/вывод, а остаток идёт дальше. Признак отмывания: много одноразовых промежуточных адресов, ' +
          'убывающие суммы, частые мелкие отправки на биржевые депозиты.',
        3,
      ],
      [
        'seed-bridge-hopping',
        'Layering через мосты (bridge hopping)',
        'Перевод между сетями через мосты (Orbiter, deBridge/DLN) для разрыва прослеживаемости. ' +
          'Несколько последовательных кроссчейн-прыжков, особенно с быстрой сменой сети и консолидацией на той стороне, ' +
          '— сильный сигнал сокрытия источника.',
        3,
      ],
      [
        'seed-cash-out',
        'Вывод через биржу (cash-out)',
        'Поток заканчивается на депозитном адресе централизованной биржи (Binance, OKX, Bybit и т.п.) — ' +
          'точка вывода в фиат. Это терминал расследования: дальше нужен запрос к бирже по KYC. ' +
          'Отметьте такие узлы как точки выхода.',
        2,
      ],
      [
        'seed-mixer-contact',
        'Контакт с миксером',
        'Взаимодействие с Tornado Cash / sanctioned-миксерами или сервисами анонимизации — высокий риск. ' +
          'Входящие из микшера обнуляют прослеживаемость источника; исходящие в микшер — попытка сокрытия.',
        4,
      ],
      [
        'seed-fanout-fanin',
        'Fan-out / fan-in (дробление и консолидация)',
        'Fan-out: один адрес рассылает средства на множество кошельков (дробление, smurfing). ' +
          'Fan-in: множество адресов сходятся в один (консолидация перед выводом). ' +
          'Резкая звезда из переводов вокруг узла заслуживает внимания.',
        2,
      ],
      [
        'seed-multichain-evm',
        'Один EVM-адрес в нескольких сетях',
        'Один и тот же 0x-адрес активен в ETH/BSC/Arbitrum/Base и др. — это один владелец (адреса EVM ' +
          'chain-agnostic). Активность сразу в нескольких сетях помогает связать поведение и найти вывод там, ' +
          'где его не ждут.',
        1,
      ],
    ];
    for (const [id, title, content, weight] of seed) {
      await q.query(
        `INSERT INTO "knowledge_entries" ("id","kind","title","content","weight","source")
         VALUES ($1,'pattern',$2,$3,$4,'seed') ON CONFLICT ("id") DO NOTHING`,
        [id, title, content, weight],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_knowledge_address"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_knowledge_kind"`);
    await q.query(`DROP TABLE IF EXISTS "knowledge_entries"`);
  }
}
