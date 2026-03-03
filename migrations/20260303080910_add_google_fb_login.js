/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable('Users', function (table) {
        table.string('GoogleId').unique().nullable();
        table.string('FacebookId').unique().nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('Users', function (table) {
        table.dropColumn('GoogleId');
        table.dropColumn('FacebookId');
    });
};