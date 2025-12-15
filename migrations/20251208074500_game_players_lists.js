/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('GamePlayers', function (table) {
        table.increments('Id').primary();
        table.integer('GameId').unsigned().notNullable();;
        table.foreign('GameId').references('Games.GameId').onDelete('CASCADE');
        table.integer('UserId').unsigned().notNullable();
        table.foreign('UserId').references('Users.Id');
        table.string('Status').defaultTo('confirmed');
        table.timestamp('JoinedAt').defaultTo(knex.fn.now());
        table.unique(['GameId', 'UserId']);
        table.string('PhoneNumber', 20).notNullable();
        table.timestamp('CanceledAt').defaultTo(knex.fn.now());
        table.timestamp('PromotedAt').defaultTo(knex.fn.now());

    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTable('GamePlayers');
};
