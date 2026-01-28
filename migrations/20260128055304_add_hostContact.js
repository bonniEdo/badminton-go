/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.string('HostContact', 100).nullable().defaultTo('現場找主揪');
    })

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.dropColumn('HostContact')
    })

};
