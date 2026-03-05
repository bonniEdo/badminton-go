/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('GameNextGroups', (table) => {
        table.increments('id').primary();
        table
            .integer('game_id')
            .unsigned()
            .notNullable()
            .unique()
            .references('GameId')
            .inTable('Games')
            .onDelete('CASCADE');
        table
            .integer('slot1_player_id')
            .unsigned()
            .nullable()
            .references('Id')
            .inTable('GamePlayers')
            .onDelete('SET NULL');
        table
            .integer('slot2_player_id')
            .unsigned()
            .nullable()
            .references('Id')
            .inTable('GamePlayers')
            .onDelete('SET NULL');
        table
            .integer('slot3_player_id')
            .unsigned()
            .nullable()
            .references('Id')
            .inTable('GamePlayers')
            .onDelete('SET NULL');
        table
            .integer('slot4_player_id')
            .unsigned()
            .nullable()
            .references('Id')
            .inTable('GamePlayers')
            .onDelete('SET NULL');
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTableIfExists('GameNextGroups');
};
