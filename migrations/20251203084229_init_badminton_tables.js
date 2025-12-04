/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    //games 表
    return knex.schema.createTable('Games', function (table) {
        table.increments('GameId').primary();
        table.string('Title', 100).notNullable();
        table.datetime('GameDate').notNullable();
        table.string('Location', 100);
        table.integer('MaxPlayers').notNullable();
        table.integer('Price').defaultTo(0);
        table.boolean('IsActive').defaultTo(true);
        table.datetime('CreatedAt').defaultTo(knex.fn.now());
    })
        .then(() => {
            return knex.schema.createTable('Signups', function (table) {
                table.increments('SignupId').primary();

                // 設定外鍵關聯 Games 表
                table.integer('GameId').unsigned().notNullable();
                table.foreign('GameId').references('Games.GameId').onDelete('CASCADE');

                table.string('PlayerName', 50).notNullable();
                table.string('CancelCode', 20).notNullable();
                table.string('SignupStatus', 20).notNullable(); // Confirmed, Waitlist
                table.datetime('SignupTime').defaultTo(knex.fn.now());
            });
        });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('Signups')
        .then(() => {
            return knex.schema.dropTableIfExists('Games');
        });
};
