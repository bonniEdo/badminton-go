/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema
        .alterTable('GamePlayers', table => {
            table.string('status').defaultTo('waiting_checkin');
            table.timestamp('check_in_at').nullable();
            table.integer('games_played').defaultTo(0);
            table.timestamp('last_end_time').nullable();
        })

        .createTable('Matches', table => {
            table.increments('id').primary();
            table.integer('game_id').unsigned().references('GameId').inTable('Games').onDelete('CASCADE');
            table.string('court_number');


            table.integer('player_a1').nullable();
            table.integer('player_a2').nullable();
            table.integer('player_b1').nullable();
            table.integer('player_b2').nullable();

            table.string('match_status').defaultTo('active');
            table.string('winner_team').nullable();
            table.timestamp('start_time').defaultTo(knex.fn.now());
            table.timestamp('end_time').nullable();

            table.timestamps(true, true);
        });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('Matches')
        .alterTable('GamePlayers', table => {
            table.dropColumn('status');
            table.dropColumn('check_in_at');
            table.dropColumn('games_played');
            table.dropColumn('last_end_time');
        });
};