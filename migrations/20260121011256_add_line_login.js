/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable('Users', (table) => {
        table.string('LineId').unique().nullable();
        table.string('AvatarUrl').nullable();
        table.string('Password').nullable().alter();
    })


};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('Users', (table) => {
        table.string('LineId').unique().nullable();
        table.string('AvatarUrl').nullable();
        table.string('Password').nullable().alter();
    })

};
