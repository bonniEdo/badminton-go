/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.integer('CurrentPlayers').notNullable().defaultTo(1);
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.dropColumn('CurrentPlayers');
    })
};