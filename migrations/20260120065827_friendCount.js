/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable('GamePlayers', (table) => {
        table.integer('FriendCount').defaultTo(0).notNullable().after('Status');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('GamePlayers', (table) => {
        table.dropColumn('FriendCount');
    });
};