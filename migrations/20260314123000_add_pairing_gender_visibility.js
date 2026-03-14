/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    const hasColumn = await knex.schema.hasColumn('Users', 'is_pairing_gender_visible');
    if (!hasColumn) {
        await knex.schema.alterTable('Users', function (table) {
            table.boolean('is_pairing_gender_visible').notNullable().defaultTo(true);
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    const hasColumn = await knex.schema.hasColumn('Users', 'is_pairing_gender_visible');
    if (!hasColumn) return;

    await knex.schema.alterTable('Users', function (table) {
        table.dropColumn('is_pairing_gender_visible');
    });
};
