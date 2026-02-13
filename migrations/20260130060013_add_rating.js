/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.table('Users', function (table) {
        table.boolean('is_profile_completed').nullable().defaultTo(false);
        table.decimal('badminton_level', 5, 2).defaultTo(1.00);
        table.string('experience_years', 100).nullable();
        table.string('play_style', 100).nullable();
        table.string('play_frequency', 100).nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.table('Users', function (table) {
        table.dropColumn('is_profile_completed');
        table.dropColumn('badminton_level');
        table.dropColumn('experience_years');
        table.dropColumn('play_style');
        table.dropColumn('play_frequency');
    });
};