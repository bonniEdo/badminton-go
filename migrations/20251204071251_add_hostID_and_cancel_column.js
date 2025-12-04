/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.integer("HostID").unsigned().references('Id').inTable('Users');
        table.timestamp('CanceledAt').defaultTo(null);
    })

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.table('Games', function (table) {
        table.dropColumn('HostID');
        table.dropColumn('CanceledAt');
    });
};
