/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('RankingSnapshots');
    if (exists) return;

    await knex.schema.createTable('RankingSnapshots', function (table) {
        table.increments('Id').primary();
        table.date('snapshot_date').notNullable();
        table.string('type', 20).notNullable();
        table.integer('window_days').notNullable();
        table.integer('public_limit').notNullable();
        table.timestamp('generated_at').notNullable().defaultTo(knex.fn.now());
        table.jsonb('ranked_all').notNullable();
        table.timestamps(true, true);

        table.unique(
            ['snapshot_date', 'type', 'window_days', 'public_limit'],
            'ranking_snapshots_daily_unique'
        );
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    const exists = await knex.schema.hasTable('RankingSnapshots');
    if (!exists) return;
    await knex.schema.dropTable('RankingSnapshots');
};
