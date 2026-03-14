/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    const hasTable = await knex.schema.hasTable('RankingSnapshots');
    if (!hasTable) return;

    const hasGenderFilter = await knex.schema.hasColumn('RankingSnapshots', 'gender_filter');
    if (!hasGenderFilter) {
        await knex.schema.alterTable('RankingSnapshots', function (table) {
            table.string('gender_filter', 20).notNullable().defaultTo('overall');
        });
    }

    try {
        await knex.schema.alterTable('RankingSnapshots', function (table) {
            table.dropUnique(
                ['snapshot_date', 'type', 'window_days', 'public_limit'],
                'ranking_snapshots_daily_unique'
            );
        });
    } catch (_) {
        // Ignore when the legacy unique key is absent.
    }

    await knex.schema.alterTable('RankingSnapshots', function (table) {
        table.unique(
            ['snapshot_date', 'type', 'window_days', 'public_limit', 'gender_filter'],
            'ranking_snapshots_daily_unique'
        );
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    const hasTable = await knex.schema.hasTable('RankingSnapshots');
    if (!hasTable) return;

    const hasGenderFilter = await knex.schema.hasColumn('RankingSnapshots', 'gender_filter');
    if (!hasGenderFilter) return;

    try {
        await knex.schema.alterTable('RankingSnapshots', function (table) {
            table.dropUnique(
                ['snapshot_date', 'type', 'window_days', 'public_limit', 'gender_filter'],
                'ranking_snapshots_daily_unique'
            );
        });
    } catch (_) {
        // Ignore when the new unique key is absent.
    }

    await knex.schema.alterTable('RankingSnapshots', function (table) {
        table.unique(
            ['snapshot_date', 'type', 'window_days', 'public_limit'],
            'ranking_snapshots_daily_unique'
        );
        table.dropColumn('gender_filter');
    });
};
