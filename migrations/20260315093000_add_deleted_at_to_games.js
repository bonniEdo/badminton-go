/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    const hasDeletedAt = await knex.schema.hasColumn('Games', 'DeletedAt');
    if (!hasDeletedAt) {
        await knex.schema.alterTable('Games', function (table) {
            table.timestamp('DeletedAt').nullable();
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    const hasDeletedAt = await knex.schema.hasColumn('Games', 'DeletedAt');
    if (hasDeletedAt) {
        await knex.schema.alterTable('Games', function (table) {
            table.dropColumn('DeletedAt');
        });
    }
};
